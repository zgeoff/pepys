use std::sync::Arc;

use serde_json::{Value, json};
use tokio::runtime::Handle;
use turso::Connection;

use crate::consumer::{ConsumerManifest, TableInfo};
use crate::database::{Store, with_transaction};
use crate::error::HostError;
use crate::fact_log::StoredFact;
use crate::links::{
    Link, LinkEnds, build_link_delete_entry, build_link_write_entry, delete_link, load_link,
    write_link,
};
use crate::module_runner::RowSource;
use crate::operations::{Operation, parse_operations, table_info};
use crate::rows::{Row, delete_row, is_same_row, key_of_read, load_row, write_row};

/// Runs a consumer on one fact and returns its operations as JSON.
pub trait FactRunner: Send {
    /// # Errors
    /// Fails when the consumer cannot run or traps.
    fn apply_fact(&mut self, fact: &str, rows: Arc<dyn RowSource>) -> Result<String, HostError>;
}

/// Serves a consumer's reads from its own file, inside the batch's open transaction.
pub struct StoreRows {
    connection: Connection,
    manifest: Arc<ConsumerManifest>,
    handle: Handle,
}

impl StoreRows {
    #[must_use]
    pub fn new(store: &Store, manifest: Arc<ConsumerManifest>) -> Self {
        Self {
            connection: store.connection.clone(),
            manifest,
            handle: Handle::current(),
        }
    }
}

impl RowSource for StoreRows {
    fn read_row(&self, table: &str, argument: &str) -> Result<Option<Vec<u8>>, HostError> {
        let info = table_info(&self.manifest, table)?;
        let key = key_of_read(table, info, argument)?;

        // The module calls this from inside the runtime's thread, so the read runs on a blocking
        // slot of the multi-thread runtime.
        tokio::task::block_in_place(|| {
            self.handle.block_on(async {
                load_row(&self.connection, table, info, &key)
                    .await?
                    .map(|row| serde_json::to_vec(&row))
                    .transpose()
                    .map_err(HostError::from)
            })
        })
    }
}

/// Applies facts of one stream as one batch: the operations the consumer returns for each, the
/// stream's new offset and one change log row commit together, or nothing is written. A batch
/// whose operations change nothing writes the offset and no change log row.
///
/// # Errors
/// Fails, after rolling the batch back, when the consumer fails, returns an operation the
/// manifest refuses, or a write fails.
pub async fn apply_batch(
    store: &Store,
    manifest: &Arc<ConsumerManifest>,
    runner: &mut dyn FactRunner,
    stream: &str,
    facts: &[StoredFact],
) -> Result<(), HostError> {
    let Some(last) = facts.last() else {
        return Ok(());
    };

    with_transaction(
        &store.connection,
        write_batch(store, manifest, runner, stream, facts, last.offset),
    )
    .await
}

async fn write_batch(
    store: &Store,
    manifest: &Arc<ConsumerManifest>,
    runner: &mut dyn FactRunner,
    stream: &str,
    facts: &[StoredFact],
    last_seq_num: u64,
) -> Result<(), HostError> {
    let rows: Arc<dyn RowSource> = Arc::new(StoreRows::new(store, Arc::clone(manifest)));
    let mut changes: Vec<Value> = Vec::new();

    for fact in facts {
        if !claim_fact(&store.connection, &fact.body).await? {
            continue;
        }

        let output = runner.apply_fact(&fact.body, Arc::clone(&rows))?;

        for operation in parse_operations(manifest, &output)? {
            if let Some(change) = apply_operation(&store.connection, manifest, operation).await? {
                changes.push(change);
            }
        }
    }

    write_offset_and_changes(&store.connection, stream, last_seq_num, &changes).await
}

/// Writes the stream's new offset and, when the batch changed something, one change log row.
///
/// # Errors
/// Fails when a statement fails.
pub async fn write_offset_and_changes(
    connection: &Connection,
    stream: &str,
    last_seq_num: u64,
    changes: &[Value],
) -> Result<(), HostError> {
    let last = i64::try_from(last_seq_num).map_err(|_| HostError::OutOfBounds)?;

    connection
        .execute(
            "INSERT OR REPLACE INTO offsets (stream, last_seq_num) VALUES (?1, ?2)",
            vec![turso::Value::from(stream), turso::Value::from(last)],
        )
        .await?;

    // A consumer of several streams reads one sequence number on each, so the batch number counts
    // the file's batches and is no stream offset.
    if !changes.is_empty() {
        connection
            .execute(
                "INSERT INTO change_log (batch, changes) \
                 VALUES ((SELECT coalesce(max(batch), 0) + 1 FROM change_log), ?1)",
                vec![turso::Value::from(serde_json::to_string(changes)?)],
            )
            .await?;
    }

    Ok(())
}

// A log can hold one fact twice, when an append is retried. The fact ID is recorded in the
// batch's transaction, so a redelivery never runs again and cannot reverse a later update. A body
// with no ID cannot repeat, so it always runs.
async fn claim_fact(connection: &Connection, body: &str) -> Result<bool, HostError> {
    let Some(id) = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|fact| fact.get("id").and_then(Value::as_str).map(str::to_owned))
    else {
        return Ok(true);
    };

    let inserted = connection
        .execute(
            "INSERT OR IGNORE INTO applied_facts (fact_id) VALUES (?1)",
            vec![turso::Value::from(id)],
        )
        .await?;

    Ok(inserted > 0)
}

/// Applies one operation and returns its change entry, or none when the store did not change.
async fn apply_operation(
    connection: &Connection,
    manifest: &ConsumerManifest,
    operation: Operation,
) -> Result<Option<Value>, HostError> {
    match operation {
        Operation::Upsert { table, key, row } => {
            let info = table_info(manifest, &table)?;
            let old = load_row(connection, &table, info, &key).await?;
            let change = pick_upsert_change(&table, &key, info, &row, old);

            if change.is_some() {
                write_row(connection, &table, info, &row).await?;
            }

            Ok(change)
        }
        Operation::Delete { table, key } => {
            let info = table_info(manifest, &table)?;
            let old = load_row(connection, &table, info, &key).await?;
            let change = pick_delete_change(&table, &key, old.as_ref());

            if change.is_some() {
                delete_row(connection, &table, info, &key).await?;
            }

            Ok(change)
        }
        Operation::Link(link) => {
            let old = load_link(connection, &link.to_ends()).await?;
            let change = pick_link_change(&link, old.as_ref());

            if change.is_some() {
                write_link(connection, &manifest.name, None, &link).await?;
            }

            Ok(change)
        }
        Operation::Unlink(ends) => {
            let is_stored = load_link(connection, &ends).await?.is_some();
            let change = pick_unlink_change(&ends, is_stored);

            if change.is_some() {
                delete_link(connection, &ends).await?;
            }

            Ok(change)
        }
    }
}

/// The change entry of an upsert against the stored row, or none when the stored row is the same.
fn pick_upsert_change(
    table: &str,
    key: &str,
    info: &TableInfo,
    row: &Row,
    old: Option<Row>,
) -> Option<Value> {
    if old.as_ref().is_some_and(|old| is_same_row(info, old, row)) {
        return None;
    }

    Some(build_write_entry(table, key, row, old))
}

/// The change entry of a delete, or none when no row is stored under the key.
fn pick_delete_change(table: &str, key: &str, old: Option<&Row>) -> Option<Value> {
    old.map(|old| build_row_delete_entry(table, key, old))
}

/// The change entry of a link against the stored link of its ends, or none when they are equal.
fn pick_link_change(link: &Link, old: Option<&Link>) -> Option<Value> {
    (old != Some(link)).then(|| build_link_write_entry(link, old))
}

/// The change entry of an unlink, or none when no link is stored for its ends.
fn pick_unlink_change(ends: &LinkEnds, is_stored: bool) -> Option<Value> {
    is_stored.then(|| build_link_delete_entry(ends))
}

/// The change entry of a written row: an insert, or an update with the stored row.
#[must_use]
pub fn build_write_entry(table: &str, key: &str, row: &Row, old: Option<Row>) -> Value {
    match old {
        Some(old) => json!({
            "type": table,
            "key": key,
            "value": row,
            "old_value": old,
            "headers": {"operation": "update"},
        }),
        None => json!({
            "type": table,
            "key": key,
            "value": row,
            "headers": {"operation": "insert"},
        }),
    }
}

/// The change entry of a deleted row, which holds the stored row as its old value.
#[must_use]
pub fn build_row_delete_entry(table: &str, key: &str, old: &Row) -> Value {
    json!({
        "type": table,
        "key": key,
        "old_value": old,
        "headers": {"operation": "delete"},
    })
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::database::{open_store, prepare_store, read_offset};
    use crate::test_utils::{
        CannedRunner, link_json, row_json, stub_manifest, stub_manifest_with_links, upsert_json,
    };

    const STREAM: &str = "facts.github.pull_request";

    async fn setup() -> (tempfile::TempDir, Store, Arc<ConsumerManifest>) {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let manifest = Arc::new(stub_manifest());
        let store = open_store(&directory.path().join("consumer.db"))
            .await
            .expect("a store");

        prepare_store(&store, &manifest.schema)
            .await
            .expect("the schema");

        (directory, store, manifest)
    }

    fn fact(offset: u64, body: &str) -> StoredFact {
        StoredFact {
            offset,
            body: body.to_owned(),
            appended_at_ms: 0,
        }
    }

    async fn change_log(store: &Store) -> Vec<(i64, Value)> {
        let mut rows = store
            .connection
            .query("SELECT batch, changes FROM change_log ORDER BY batch", ())
            .await
            .expect("a query");
        let mut result = Vec::new();

        while let Some(row) = rows.next().await.expect("a row") {
            let batch: i64 = row.get(0).expect("a batch");
            let changes: String = row.get(1).expect("changes");

            result.push((batch, serde_json::from_str(&changes).expect("json")));
        }

        result
    }

    async fn count_rows(store: &Store) -> i64 {
        let mut rows = store
            .connection
            .query("SELECT count(*) FROM github_pull_request", ())
            .await
            .expect("a query");

        rows.next()
            .await
            .expect("a row")
            .expect("a count")
            .get(0)
            .expect("an integer")
    }

    // Upserts a row of a one-column key of `kind` written as `value`, then deletes it by the same
    // text, in two batches. Returns the rows left and each change log entry's operation and key.
    async fn run_upsert_then_delete(
        kind: &str,
        sql_type: &str,
        value: &str,
    ) -> (i64, Vec<(String, String)>) {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let mut manifest = stub_manifest();

        manifest.tables = serde_json::from_value(json!({
            "item": {
                "columns": {"id": {"kind": kind, "nullable": false}},
                "primaryKey": ["id"],
                "indexes": []
            }
        }))
        .expect("the tables");
        manifest.schema = format!("CREATE TABLE item (id {sql_type} NOT NULL PRIMARY KEY);");

        let manifest = Arc::new(manifest);
        let store = open_store(&directory.path().join("consumer.db"))
            .await
            .expect("a store");

        prepare_store(&store, &manifest.schema)
            .await
            .expect("the schema");

        let mut canned = CannedRunner::new(&[
            (
                "a",
                Ok(format!(r#"[{{"upsert":{{"item":{{"id":{value}}}}}}}]"#)),
            ),
            (
                "b",
                Ok(format!(r#"[{{"delete":{{"item":{{"id":{value}}}}}}}]"#)),
            ),
        ]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the upsert");
        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(1, "b")])
            .await
            .expect("the delete");

        let mut rows = store
            .connection
            .query("SELECT count(*) FROM item", ())
            .await
            .expect("a count");
        let left: i64 = rows
            .next()
            .await
            .expect("a row")
            .expect("a count row")
            .get(0)
            .expect("an integer");
        let entries = change_log(&store)
            .await
            .into_iter()
            .flat_map(|(_, changes)| changes.as_array().cloned().unwrap_or_default())
            .map(|entry| {
                (
                    entry["headers"]["operation"]
                        .as_str()
                        .unwrap_or("")
                        .to_owned(),
                    entry["key"].as_str().unwrap_or("").to_owned(),
                )
            })
            .collect();

        (left, entries)
    }

    fn insert_then_delete(key: &str) -> Vec<(String, String)> {
        vec![
            ("insert".to_owned(), key.to_owned()),
            ("delete".to_owned(), key.to_owned()),
        ]
    }

    #[tokio::test]
    async fn it_deletes_a_real_key_halfway_between_two_shortest_texts_by_the_key_it_wrote() {
        assert_eq!(
            run_upsert_then_delete("real", "REAL", "1000000000000000.2").await,
            (0, insert_then_delete("[1000000000000000.2]"))
        );
    }

    #[tokio::test]
    async fn it_deletes_a_real_key_with_a_long_fraction_by_the_key_it_wrote() {
        assert_eq!(
            run_upsert_then_delete("real", "REAL", "3713064193725.5859").await,
            (0, insert_then_delete("[3713064193725.586]"))
        );
    }

    #[tokio::test]
    async fn it_deletes_a_real_key_past_2_to_the_53_by_the_key_it_wrote() {
        assert_eq!(
            run_upsert_then_delete("real", "REAL", "9007199254740993").await,
            (0, insert_then_delete("[9007199254740992]"))
        );
    }

    #[tokio::test]
    async fn it_deletes_a_json_key_written_as_2_0_by_the_key_it_wrote() {
        assert_eq!(
            run_upsert_then_delete("json", "TEXT", "2.0").await,
            (0, insert_then_delete("[2]"))
        );
    }

    #[tokio::test]
    async fn it_rolls_the_batch_back_when_the_change_log_write_fails() {
        let (_directory, store, manifest) = setup().await;
        let mut canned =
            CannedRunner::new(&[("a", Ok(upsert_json("github:pull_request:1", "First")))]);

        store
            .connection
            .execute("DROP TABLE change_log", ())
            .await
            .expect("the drop");

        let result = apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(4, "a")]).await;

        assert!(result.is_err());
        assert_eq!(
            (
                count_rows(&store).await,
                read_offset(&store, STREAM).await.expect("an offset"),
            ),
            (0, None)
        );
    }

    #[tokio::test]
    async fn it_commits_the_rows_the_offset_and_the_change_log_row_together() {
        let (_directory, store, manifest) = setup().await;
        let mut canned =
            CannedRunner::new(&[("a", Ok(upsert_json("github:pull_request:1", "First")))]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(4, "a")])
            .await
            .expect("the batch applies");

        assert_eq!(
            (
                count_rows(&store).await,
                read_offset(&store, STREAM).await.expect("an offset"),
                change_log(&store).await,
            ),
            (
                1,
                Some(4),
                vec![(
                    1,
                    json!([{
                        "type": "github_pull_request",
                        "key": r#"["github:pull_request:1"]"#,
                        "value": row_json("github:pull_request:1", "First"),
                        "headers": {"operation": "insert"}
                    }])
                )]
            )
        );
    }

    #[tokio::test]
    async fn it_logs_an_update_with_the_old_value_for_a_key_that_exists() {
        let (_directory, store, manifest) = setup().await;
        let mut canned = CannedRunner::new(&[
            ("a", Ok(upsert_json("github:pull_request:1", "First"))),
            ("b", Ok(upsert_json("github:pull_request:1", "Second"))),
        ]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the first batch applies");
        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(1, "b")])
            .await
            .expect("the second batch applies");

        assert_eq!(
            change_log(&store).await[1],
            (
                2,
                json!([{
                    "type": "github_pull_request",
                    "key": r#"["github:pull_request:1"]"#,
                    "value": row_json("github:pull_request:1", "Second"),
                    "old_value": row_json("github:pull_request:1", "First"),
                    "headers": {"operation": "update"}
                }])
            )
        );
    }

    #[tokio::test]
    async fn it_logs_an_insert_then_an_update_for_a_key_written_twice_in_one_batch() {
        let (_directory, store, manifest) = setup().await;
        let mut canned = CannedRunner::new(&[
            ("a", Ok(upsert_json("github:pull_request:1", "First"))),
            ("b", Ok(upsert_json("github:pull_request:1", "Second"))),
        ]);

        apply_batch(
            &store,
            &manifest,
            &mut canned,
            STREAM,
            &[fact(0, "a"), fact(1, "b")],
        )
        .await
        .expect("the batch applies");

        let log = change_log(&store).await;
        let operations: Vec<&Value> = log[0]
            .1
            .as_array()
            .expect("a list")
            .iter()
            .map(|change| &change["headers"]["operation"])
            .collect();

        assert_eq!(operations, vec![&json!("insert"), &json!("update")]);
    }

    #[tokio::test]
    async fn it_skips_a_fact_delivered_again_so_it_cannot_reverse_a_later_update() {
        let (_directory, store, manifest) = setup().await;
        let open = r#"{"id":"delivery-1"}"#;
        let close = r#"{"id":"delivery-2"}"#;
        let mut canned = CannedRunner::new(&[
            (open, Ok(upsert_json("github:pull_request:1", "Open"))),
            (close, Ok(upsert_json("github:pull_request:1", "Closed"))),
        ]);

        apply_batch(
            &store,
            &manifest,
            &mut canned,
            STREAM,
            &[fact(0, open), fact(1, close)],
        )
        .await
        .expect("the first batch applies");
        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(2, open)])
            .await
            .expect("the redelivery applies");

        let mut rows = store
            .connection
            .query("SELECT title FROM github_pull_request", ())
            .await
            .expect("a query");
        let title: String = rows
            .next()
            .await
            .expect("a row")
            .expect("a title row")
            .get(0)
            .expect("a title");

        assert_eq!(
            (
                title,
                change_log(&store).await.len(),
                read_offset(&store, STREAM).await.expect("an offset")
            ),
            ("Closed".to_owned(), 1, Some(2))
        );
    }

    #[tokio::test]
    async fn it_deletes_a_row_and_logs_the_old_value() {
        let (_directory, store, manifest) = setup().await;
        let delete = json!([{"delete": {"github_pull_request": {"id": "github:pull_request:1"}}}])
            .to_string();
        let mut canned = CannedRunner::new(&[
            ("a", Ok(upsert_json("github:pull_request:1", "First"))),
            ("b", Ok(delete)),
        ]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the first batch applies");
        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(1, "b")])
            .await
            .expect("the second batch applies");

        assert_eq!(
            (
                count_rows(&store).await,
                change_log(&store).await[1].clone()
            ),
            (
                0,
                (
                    2,
                    json!([{
                        "type": "github_pull_request",
                        "key": r#"["github:pull_request:1"]"#,
                        "old_value": row_json("github:pull_request:1", "First"),
                        "headers": {"operation": "delete"}
                    }])
                )
            )
        );
    }

    #[tokio::test]
    async fn it_writes_the_offset_and_no_change_log_row_for_a_batch_that_changes_nothing() {
        let (_directory, store, manifest) = setup().await;
        let mut canned = CannedRunner::new(&[]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(7, "a")])
            .await
            .expect("the batch applies");

        assert_eq!(
            (
                read_offset(&store, STREAM).await.expect("an offset"),
                change_log(&store).await.len()
            ),
            (Some(7), 0)
        );
    }

    #[tokio::test]
    async fn it_rejects_an_operation_on_a_table_the_consumer_does_not_own_and_writes_nothing() {
        let (_directory, store, manifest) = setup().await;
        let foreign = json!([{"upsert": {"someone_elses_table": {"id": "x"}}}]).to_string();
        let mut canned = CannedRunner::new(&[
            ("a", Ok(upsert_json("github:pull_request:1", "First"))),
            ("b", Ok(foreign)),
        ]);

        let result = apply_batch(
            &store,
            &manifest,
            &mut canned,
            STREAM,
            &[fact(0, "a"), fact(1, "b")],
        )
        .await;

        assert_eq!(
            (
                result.map_err(|error| error.to_string()),
                count_rows(&store).await,
                read_offset(&store, STREAM).await.expect("an offset"),
                change_log(&store).await.len(),
            ),
            (
                Err("the consumer returned an operation on someone_elses_table, which it does not own".to_owned()),
                0,
                None,
                0
            )
        );
    }

    #[tokio::test]
    async fn it_writes_nothing_when_the_consumer_fails_on_a_later_fact() {
        let (_directory, store, manifest) = setup().await;
        let mut canned = CannedRunner::new(&[
            ("a", Ok(upsert_json("github:pull_request:1", "First"))),
            ("b", Err("boom".to_owned())),
        ]);

        let result = apply_batch(
            &store,
            &manifest,
            &mut canned,
            STREAM,
            &[fact(0, "a"), fact(1, "b")],
        )
        .await;

        assert_eq!(
            (
                result.is_err(),
                count_rows(&store).await,
                read_offset(&store, STREAM).await.expect("an offset"),
            ),
            (true, 0, None)
        );
    }

    #[tokio::test]
    async fn it_logs_no_change_for_an_upsert_equal_to_the_stored_row() {
        let (_directory, store, manifest) = setup().await;
        let mut canned = CannedRunner::new(&[
            ("a", Ok(upsert_json("github:pull_request:1", "First"))),
            ("b", Ok(upsert_json("github:pull_request:1", "First"))),
        ]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the first batch applies");
        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(1, "b")])
            .await
            .expect("the second batch applies");

        assert_eq!(change_log(&store).await.len(), 1);
    }

    #[tokio::test]
    async fn it_logs_no_change_for_a_delete_of_a_row_that_is_not_stored() {
        let (_directory, store, manifest) = setup().await;
        let delete = json!([{"delete": {"github_pull_request": {"id": "github:pull_request:9"}}}])
            .to_string();
        let mut canned = CannedRunner::new(&[("a", Ok(delete))]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the batch applies");

        assert_eq!(change_log(&store).await.len(), 0);
    }

    #[tokio::test]
    async fn it_numbers_the_change_log_rows_of_two_streams_apart() {
        let (_directory, store, _) = setup().await;
        let mut two_streams = stub_manifest();

        two_streams.input = crate::consumer::ConsumerInput::Fact {
            streams: vec![STREAM.to_owned(), "facts.github.review".to_owned()],
        };

        let manifest = Arc::new(two_streams);
        let mut canned = CannedRunner::new(&[
            ("a", Ok(upsert_json("github:pull_request:1", "First"))),
            ("b", Ok(upsert_json("github:pull_request:2", "Second"))),
        ]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the first stream's batch applies");
        apply_batch(
            &store,
            &manifest,
            &mut canned,
            "facts.github.review",
            &[fact(0, "b")],
        )
        .await
        .expect("the second stream's batch applies");

        assert_eq!(
            change_log(&store)
                .await
                .into_iter()
                .map(|(batch, _)| batch)
                .collect::<Vec<_>>(),
            vec![1, 2]
        );
    }

    async fn setup_with_links() -> (tempfile::TempDir, Store, Arc<ConsumerManifest>) {
        let (directory, store, _) = setup().await;

        (directory, store, Arc::new(stub_manifest_with_links()))
    }

    async fn count(store: &Store, table: &str) -> i64 {
        let mut rows = store
            .connection
            .query(&format!("SELECT count(*) FROM {table}"), ())
            .await
            .expect("a query");

        rows.next()
            .await
            .expect("a row")
            .expect("a count")
            .get(0)
            .expect("an integer")
    }

    type LinkColumns = (String, String, String, Option<String>, String, f64, String);

    async fn read_links(store: &Store) -> Vec<LinkColumns> {
        let mut rows = store
            .connection
            .query(
                "SELECT type, from_id, to_id, scope, origin, confidence, evidence FROM link \
                 ORDER BY type, from_id, to_id",
                (),
            )
            .await
            .expect("a query");
        let mut links = Vec::new();

        while let Some(row) = rows.next().await.expect("a row") {
            links.push((
                row.get(0).expect("a type"),
                row.get(1).expect("a from"),
                row.get(2).expect("a to"),
                row.get(3).expect("a scope"),
                row.get(4).expect("an origin"),
                row.get(5).expect("a confidence"),
                row.get(6).expect("an evidence"),
            ));
        }

        links
    }

    fn operations_json(operations: &[Value]) -> String {
        Value::Array(operations.to_vec()).to_string()
    }

    #[tokio::test]
    async fn it_writes_a_link_to_an_entity_with_no_row_with_no_scope_and_the_consumer_as_origin() {
        let (_directory, store, manifest) = setup_with_links().await;
        let output = operations_json(&[link_json(
            "opened_by",
            "github:pull_request:1",
            "github:user:7",
            0.5,
        )]);
        let mut canned = CannedRunner::new(&[("a", Ok(output))]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the batch applies");

        assert_eq!(
            read_links(&store).await,
            vec![(
                "opened_by".to_owned(),
                "github:pull_request:1".to_owned(),
                "github:user:7".to_owned(),
                None,
                "github_pull_request".to_owned(),
                0.5,
                "event:github:delivery-1".to_owned(),
            )]
        );
    }

    #[tokio::test]
    async fn it_logs_a_written_link_as_an_insert_keyed_by_its_type_and_ends() {
        let (_directory, store, manifest) = setup_with_links().await;
        let output = operations_json(&[link_json(
            "opened_by",
            "github:pull_request:1",
            "github:user:7",
            1.0,
        )]);
        let mut canned = CannedRunner::new(&[("a", Ok(output))]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the batch applies");

        assert_eq!(
            change_log(&store).await,
            vec![(
                1,
                json!([{
                    "type": "link",
                    "key": r#"["opened_by","github:pull_request:1","github:user:7"]"#,
                    "value": {
                        "type": "opened_by", "from": "github:pull_request:1",
                        "to": "github:user:7", "confidence": 1.0,
                        "evidence": "event:github:delivery-1"
                    },
                    "headers": {"operation": "insert"}
                }])
            )]
        );
    }

    #[tokio::test]
    async fn it_logs_a_changed_link_as_an_update_with_the_old_value() {
        let (_directory, store, manifest) = setup_with_links().await;
        let mut canned = CannedRunner::new(&[
            (
                "a",
                Ok(operations_json(&[link_json(
                    "opened_by",
                    "github:pull_request:1",
                    "github:user:7",
                    0.5,
                )])),
            ),
            (
                "b",
                Ok(operations_json(&[link_json(
                    "opened_by",
                    "github:pull_request:1",
                    "github:user:7",
                    1.0,
                )])),
            ),
        ]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the first batch applies");
        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(1, "b")])
            .await
            .expect("the second batch applies");

        assert_eq!(
            change_log(&store).await[1],
            (
                2,
                json!([{
                    "type": "link",
                    "key": r#"["opened_by","github:pull_request:1","github:user:7"]"#,
                    "value": {
                        "type": "opened_by", "from": "github:pull_request:1",
                        "to": "github:user:7", "confidence": 1.0,
                        "evidence": "event:github:delivery-1"
                    },
                    "old_value": {
                        "type": "opened_by", "from": "github:pull_request:1",
                        "to": "github:user:7", "confidence": 0.5,
                        "evidence": "event:github:delivery-1"
                    },
                    "headers": {"operation": "update"}
                }])
            )
        );
    }

    #[tokio::test]
    async fn it_logs_no_change_for_a_link_equal_to_the_stored_one() {
        let (_directory, store, manifest) = setup_with_links().await;
        let output = operations_json(&[link_json(
            "opened_by",
            "github:pull_request:1",
            "github:user:7",
            1.0,
        )]);
        let mut canned = CannedRunner::new(&[("a", Ok(output.clone())), ("b", Ok(output))]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the first batch applies");
        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(1, "b")])
            .await
            .expect("the second batch applies");

        assert_eq!(change_log(&store).await.len(), 1);
    }

    #[tokio::test]
    async fn it_deletes_a_link_on_unlink_and_logs_its_key() {
        let (_directory, store, manifest) = setup_with_links().await;
        let unlink = operations_json(&[json!({"unlink": {
            "type": "opened_by", "from": "github:pull_request:1", "to": "github:user:7"
        }})]);
        let mut canned = CannedRunner::new(&[
            (
                "a",
                Ok(operations_json(&[link_json(
                    "opened_by",
                    "github:pull_request:1",
                    "github:user:7",
                    1.0,
                )])),
            ),
            ("b", Ok(unlink)),
        ]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the first batch applies");
        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(1, "b")])
            .await
            .expect("the second batch applies");

        assert_eq!(
            (
                count(&store, "link").await,
                change_log(&store).await[1].clone()
            ),
            (
                0,
                (
                    2,
                    json!([{
                        "type": "link",
                        "key": r#"["opened_by","github:pull_request:1","github:user:7"]"#,
                        "headers": {"operation": "delete"}
                    }])
                )
            )
        );
    }

    #[tokio::test]
    async fn it_logs_no_change_for_an_unlink_of_a_link_that_is_not_stored() {
        let (_directory, store, manifest) = setup_with_links().await;
        let unlink = operations_json(&[json!({"unlink": {
            "type": "opened_by", "from": "github:pull_request:1", "to": "github:user:7"
        }})]);
        let mut canned = CannedRunner::new(&[("a", Ok(unlink))]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the batch applies");

        assert_eq!(change_log(&store).await.len(), 0);
    }

    // A good fact with a row and a link, then a fact whose link the check refuses. The batch
    // returns the refusal and leaves every table as it was.
    async fn apply_good_fact_then_bad_link(bad_link: Value) -> (String, [i64; 4], Option<u64>) {
        let (_directory, store, manifest) = setup_with_links().await;
        let good = r#"{"id":"delivery-1"}"#;
        let bad = r#"{"id":"delivery-2"}"#;
        let good_output = operations_json(&[
            json!({"upsert": {"github_pull_request": row_json("github:pull_request:1", "First")}}),
            link_json("opened_by", "github:pull_request:1", "github:user:7", 1.0),
        ]);
        let mut canned = CannedRunner::new(&[
            (good, Ok(good_output)),
            (bad, Ok(operations_json(&[bad_link]))),
        ]);

        let result = apply_batch(
            &store,
            &manifest,
            &mut canned,
            STREAM,
            &[fact(0, good), fact(1, bad)],
        )
        .await;

        (
            result.map_or_else(|error| error.to_string(), |()| "applied".to_owned()),
            [
                count(&store, "github_pull_request").await,
                count(&store, "link").await,
                count(&store, "change_log").await,
                count(&store, "applied_facts").await,
            ],
            read_offset(&store, STREAM).await.expect("an offset"),
        )
    }

    #[tokio::test]
    async fn it_rolls_the_batch_back_for_a_link_of_an_undeclared_type() {
        let outcome = apply_good_fact_then_bad_link(link_json(
            "closed_by",
            "github:pull_request:1",
            "github:user:7",
            1.0,
        ))
        .await;

        assert_eq!(
            outcome,
            (
                "the consumer returned a link the host refuses: its type closed_by is not one the \
                 consumer declares"
                    .to_owned(),
                [0, 0, 0, 0],
                None
            )
        );
    }

    #[tokio::test]
    async fn it_rolls_the_batch_back_for_a_link_end_of_a_kind_the_type_does_not_allow() {
        let outcome = apply_good_fact_then_bad_link(link_json(
            "opened_by",
            "github:pull_request:1",
            "github:team:7",
            1.0,
        ))
        .await;

        assert_eq!(
            outcome,
            (
                "the consumer returned a link the host refuses: the to end github:team:7 is of a \
                 kind that opened_by does not allow; it allows github:user"
                    .to_owned(),
                [0, 0, 0, 0],
                None
            )
        );
    }

    #[tokio::test]
    async fn it_rolls_the_batch_back_for_a_link_end_that_is_no_entity_id() {
        let outcome = apply_good_fact_then_bad_link(link_json(
            "opened_by",
            "GitHub:pull_request:1",
            "github:user:7",
            1.0,
        ))
        .await;

        assert_eq!(
            outcome,
            (
                "the consumer returned a link the host refuses: the from end \
                 GitHub:pull_request:1 is not an entity ID"
                    .to_owned(),
                [0, 0, 0, 0],
                None
            )
        );
    }

    fn pull_request_row(title: &str) -> Row {
        serde_json::from_value(row_json("github:pull_request:1", title)).expect("a row")
    }

    fn opened_by(confidence: f64) -> Link {
        serde_json::from_value(
            link_json(
                "opened_by",
                "github:pull_request:1",
                "github:user:7",
                confidence,
            )["link"]
                .clone(),
        )
        .expect("a link")
    }

    #[test]
    fn it_picks_the_change_of_an_upsert_from_the_stored_row() {
        let manifest = stub_manifest();
        let info = &manifest.tables["github_pull_request"];
        let cases = [
            ("no stored row", None),
            ("an equal stored row", Some(pull_request_row("First"))),
            ("a different stored row", Some(pull_request_row("Old"))),
        ];

        let picked: Vec<(&str, Option<Value>)> = cases
            .into_iter()
            .map(|(case, old)| {
                let row = pull_request_row("First");

                (
                    case,
                    pick_upsert_change("github_pull_request", "k", info, &row, old),
                )
            })
            .collect();

        assert_eq!(
            picked,
            vec![
                (
                    "no stored row",
                    Some(json!({
                        "type": "github_pull_request", "key": "k",
                        "value": row_json("github:pull_request:1", "First"),
                        "headers": {"operation": "insert"}
                    }))
                ),
                ("an equal stored row", None),
                (
                    "a different stored row",
                    Some(json!({
                        "type": "github_pull_request", "key": "k",
                        "value": row_json("github:pull_request:1", "First"),
                        "old_value": row_json("github:pull_request:1", "Old"),
                        "headers": {"operation": "update"}
                    }))
                ),
            ]
        );
    }

    #[test]
    fn it_picks_the_change_of_a_delete_from_the_stored_row() {
        let stored = pull_request_row("First");
        let cases = [("no stored row", None), ("a stored row", Some(&stored))];

        let picked: Vec<(&str, Option<Value>)> = cases
            .into_iter()
            .map(|(case, old)| (case, pick_delete_change("github_pull_request", "k", old)))
            .collect();

        assert_eq!(
            picked,
            vec![
                ("no stored row", None),
                (
                    "a stored row",
                    Some(json!({
                        "type": "github_pull_request", "key": "k",
                        "old_value": row_json("github:pull_request:1", "First"),
                        "headers": {"operation": "delete"}
                    }))
                ),
            ]
        );
    }

    #[test]
    fn it_picks_the_change_of_a_link_from_the_stored_link() {
        let cases = [
            ("no stored link", None),
            ("an equal stored link", Some(opened_by(1.0))),
            ("a stored link of another confidence", Some(opened_by(0.5))),
        ];

        let picked: Vec<(&str, Option<Value>)> = cases
            .into_iter()
            .map(|(case, old)| (case, pick_link_change(&opened_by(1.0), old.as_ref())))
            .collect();

        assert_eq!(
            picked,
            vec![
                (
                    "no stored link",
                    Some(json!({
                        "type": "link",
                        "key": r#"["opened_by","github:pull_request:1","github:user:7"]"#,
                        "value": link_json("opened_by", "github:pull_request:1", "github:user:7", 1.0)["link"],
                        "headers": {"operation": "insert"}
                    }))
                ),
                ("an equal stored link", None),
                (
                    "a stored link of another confidence",
                    Some(json!({
                        "type": "link",
                        "key": r#"["opened_by","github:pull_request:1","github:user:7"]"#,
                        "value": link_json("opened_by", "github:pull_request:1", "github:user:7", 1.0)["link"],
                        "old_value": link_json("opened_by", "github:pull_request:1", "github:user:7", 0.5)["link"],
                        "headers": {"operation": "update"}
                    }))
                ),
            ]
        );
    }

    #[test]
    fn it_picks_the_change_of_an_unlink_from_whether_the_link_is_stored() {
        let ends = opened_by(1.0).to_ends();
        let cases = [("no stored link", false), ("a stored link", true)];

        let picked: Vec<(&str, Option<Value>)> = cases
            .into_iter()
            .map(|(case, is_stored)| (case, pick_unlink_change(&ends, is_stored)))
            .collect();

        assert_eq!(
            picked,
            vec![
                ("no stored link", None),
                (
                    "a stored link",
                    Some(json!({
                        "type": "link",
                        "key": r#"["opened_by","github:pull_request:1","github:user:7"]"#,
                        "headers": {"operation": "delete"}
                    }))
                ),
            ]
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_serves_a_row_read_of_a_one_column_key_by_its_bare_value() {
        let (_directory, store, manifest) = setup().await;
        let mut canned =
            CannedRunner::new(&[("a", Ok(upsert_json("github:pull_request:1", "First")))]);

        apply_batch(&store, &manifest, &mut canned, STREAM, &[fact(0, "a")])
            .await
            .expect("the batch applies");

        let rows = StoreRows::new(&store, Arc::clone(&manifest));
        let read = (
            rows.read_row("github_pull_request", "github:pull_request:1")
                .expect("a read"),
            rows.read_row("github_pull_request", "github:pull_request:2")
                .expect("a read"),
        );

        assert_eq!(
            (
                read.0
                    .map(|bytes| serde_json::from_slice::<Value>(&bytes).expect("JSON")),
                read.1
            ),
            (Some(row_json("github:pull_request:1", "First")), None)
        );
    }
}
