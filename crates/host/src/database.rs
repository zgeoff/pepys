use std::path::Path;

use turso::{Builder, Connection, Database, Value};

use crate::error::HostError;

const HOST_TABLES: &str = "
CREATE TABLE offsets (stream TEXT NOT NULL PRIMARY KEY, last_seq_num INTEGER NOT NULL);
CREATE TABLE change_log (batch INTEGER NOT NULL PRIMARY KEY, changes TEXT NOT NULL);
";

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

    Ok(Store {
        _database: database,
        connection,
    })
}

/// Creates the consumer's tables from its generated schema and the host's own tables, when the
/// file has none yet.
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

    if rows.next().await?.is_some() {
        return Ok(());
    }

    store
        .connection
        .execute_batch(&format!("{consumer_schema}\n{HOST_TABLES}"))
        .await?;

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
