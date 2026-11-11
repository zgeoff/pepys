use std::path::Path;
use std::time::Duration;

use turso::{Builder, Connection, Database, Value};

use crate::error::HostError;

const HOST_TABLES: &str = "
CREATE TABLE offsets (stream TEXT NOT NULL PRIMARY KEY, last_seq_num INTEGER NOT NULL);
CREATE TABLE change_log (batch INTEGER NOT NULL PRIMARY KEY, changes TEXT NOT NULL);
";

const APPLIED_FACTS_TABLE: &str =
    "CREATE TABLE IF NOT EXISTS applied_facts (fact_id TEXT NOT NULL PRIMARY KEY)";

// Every consumer file has a `link` table, with or without a link type, so an unlink from a consumer
// with no link type deletes nothing, as in the test store, and does not fail on a missing table.
// One file holds one consumer, so `origin` is the same in every row and the key leaves it out.
const LINK_TABLE: &str = "CREATE TABLE IF NOT EXISTS link (type TEXT NOT NULL, \
     from_id TEXT NOT NULL, to_id TEXT NOT NULL, scope TEXT, origin TEXT NOT NULL, \
     confidence REAL NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY (type, from_id, to_id))";

const LINK_TO_ID_INDEX: &str = "CREATE INDEX IF NOT EXISTS link_to_id_idx ON link (to_id)";

const LOCK_WAIT: Duration = Duration::from_secs(10);

/// One consumer file, opened with Turso's multi-process WAL so that readers in other processes
/// see each commit.
pub struct Store {
    _database: Database,
    pub connection: Connection,
}

/// Opens the file at `path`, creating it when it is missing.
///
/// # Errors
/// Fails when Turso cannot open the file.
pub async fn open_store(path: &Path) -> Result<Store, HostError> {
    let location = path
        .to_str()
        .ok_or_else(|| HostError::Config(format!("{} is not UTF-8", path.display())))?;
    let database = Builder::new_local(location)
        .experimental_multiprocess_wal(true)
        .build()
        .await?;
    let connection = database.connect()?;

    // Turso gives "database is locked" at once by default. A reader in another process, such as
    // the API, holds the file for a moment, and without a wait that stops the consumer's task.
    connection.busy_timeout(LOCK_WAIT)?;

    Ok(Store {
        _database: database,
        connection,
    })
}

/// Creates the consumer's tables from its generated schema and the host's own tables, when the
/// file has none yet, and the tables of applied fact IDs and of links when they are missing.
///
/// # Errors
/// Fails when a statement fails.
pub async fn prepare_store(store: &Store, consumer_schema: &str) -> Result<(), HostError> {
    let mut rows = store
        .connection
        .query(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'offsets'",
            (),
        )
        .await?;

    let prepared = rows.next().await?.is_some();

    if !prepared {
        store
            .connection
            .execute_batch(&format!("{consumer_schema}\n{HOST_TABLES}"))
            .await?;
    }

    store.connection.execute(APPLIED_FACTS_TABLE, ()).await?;
    store.connection.execute(LINK_TABLE, ()).await?;
    store.connection.execute(LINK_TO_ID_INDEX, ()).await?;

    Ok(())
}

/// The sequence number of the last record applied from `stream`, or `None` before the first.
///
/// # Errors
/// Fails when the query fails.
pub async fn read_offset(store: &Store, stream: &str) -> Result<Option<u64>, HostError> {
    let mut rows = store
        .connection
        .query(
            "SELECT last_seq_num FROM offsets WHERE stream = ?1",
            vec![Value::from(stream)],
        )
        .await?;

    let Some(row) = rows.next().await? else {
        return Ok(None);
    };
    let value: i64 = row.get(0)?;

    Ok(u64::try_from(value).ok())
}

/// Runs a checkpoint, so the main file holds every committed page.
///
/// # Errors
/// Fails when the pragma fails.
pub async fn checkpoint(store: &Store) -> Result<(), HostError> {
    let mut rows = store
        .connection
        .query("PRAGMA wal_checkpoint(TRUNCATE)", ())
        .await?;

    while rows.next().await?.is_some() {}

    Ok(())
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn it_makes_the_link_table_with_the_columns_of_the_test_store() {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let store = open_store(&directory.path().join("consumer.db"))
            .await
            .expect("a store");

        prepare_store(&store, "").await.expect("the host's tables");

        let mut rows = store
            .connection
            .query(
                "SELECT name, type, \"notnull\" FROM pragma_table_info('link')",
                (),
            )
            .await
            .expect("a query");
        let mut columns: Vec<(String, String, i64)> = Vec::new();

        while let Some(row) = rows.next().await.expect("a row") {
            columns.push((
                row.get(0).expect("a name"),
                row.get(1).expect("a type"),
                row.get(2).expect("a flag"),
            ));
        }

        assert_eq!(
            columns,
            [
                ("type", "TEXT", 1),
                ("from_id", "TEXT", 1),
                ("to_id", "TEXT", 1),
                ("scope", "TEXT", 0),
                ("origin", "TEXT", 1),
                ("confidence", "REAL", 1),
                ("evidence", "TEXT", 1),
            ]
            .map(|(name, kind, not_null)| (name.to_owned(), kind.to_owned(), not_null))
            .to_vec()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_waits_for_a_lock_that_another_handle_holds_and_then_writes() {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let path = directory.path().join("consumer.db");
        let holder = open_store(&path).await.expect("a store");
        prepare_store(&holder, "").await.expect("the host's tables");
        let waiter = open_store(&path).await.expect("a second handle");

        holder
            .connection
            .execute("BEGIN IMMEDIATE", ())
            .await
            .expect("a held write lock");
        holder
            .connection
            .execute("INSERT INTO applied_facts (fact_id) VALUES ('held')", ())
            .await
            .expect("a write under the lock");

        let release = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(300)).await;
            holder
                .connection
                .execute("COMMIT", ())
                .await
                .expect("a commit");
        });

        let written = waiter
            .connection
            .execute("INSERT INTO applied_facts (fact_id) VALUES ('waited')", ())
            .await;

        release.await.expect("the release task");

        assert_eq!(written.expect("a write after the wait"), 1);
    }
}
