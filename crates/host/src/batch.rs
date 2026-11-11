use std::sync::Arc;

use serde_json::{Value, json};
use tokio::runtime::Handle;
use turso::Connection;

use crate::consumer::{ConsumerManifest, TableInfo};
use crate::database::Store;
use crate::error::HostError;
use crate::fact_log::StoredFact;
use crate::module_runner::RowSource;
use crate::operations::{Operation, parse_operations};
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

fn table_info<'a>(manifest: &'a ConsumerManifest, table: &str) -> Result<&'a TableInfo, HostError> {
    manifest
        .tables
        .get(table)
        .ok_or_else(|| HostError::NotOwned {
            table: table.to_owned(),
        })
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

    store.connection.execute("BEGIN IMMEDIATE", ()).await?;

    match write_batch(store, manifest, runner, stream, facts, last.offset).await {
        Ok(()) => {
            store.connection.execute("COMMIT", ()).await?;

            Ok(())
        }
        Err(error) => {
            store.connection.execute("ROLLBACK", ()).await?;

            Err(error)
        }
    }
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

    let last = i64::try_from(last_seq_num).map_err(|_| HostError::OutOfBounds)?;

    store
        .connection
        .execute(
            "INSERT OR REPLACE INTO offsets (stream, last_seq_num) VALUES (?1, ?2)",
            vec![turso::Value::from(stream), turso::Value::from(last)],
        )
        .await?;

    // A consumer of several streams reads one sequence number on each, so the batch number counts
    // the file's batches and is no stream offset.
    if !changes.is_empty() {
        store
            .connection
            .execute(
                "INSERT INTO change_log (batch, changes) \
                 VALUES ((SELECT coalesce(max(batch), 0) + 1 FROM change_log), ?1)",
                vec![turso::Value::from(serde_json::to_string(&changes)?)],
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

            if old.as_ref().is_some_and(|old| is_same_row(info, old, &row)) {
                return Ok(None);
            }

            write_row(connection, &table, info, &row).await?;

            Ok(Some(build_write_entry(&table, &key, &row, old)))
        }
        Operation::Delete { table, key } => {
            let info = table_info(manifest, &table)?;
            let Some(old) = load_row(connection, &table, info, &key).await? else {
                return Ok(None);
            };

            delete_row(connection, &table, info, &key).await?;

            Ok(Some(json!({
                "type": table,
                "key": key,
                "old_value": old,
                "headers": {"operation": "delete"},
            })))
        }
        Operation::Link(link) => Err(HostError::BadOperation(format!(
            "this host writes no links, and the consumer returned a {} link",
            link.link_type
        ))),
        Operation::Unlink(ends) => Err(HostError::BadOperation(format!(
            "this host writes no links, and the consumer returned a {} unlink",
            ends.link_type
        ))),
    }
}

fn build_write_entry(table: &str, key: &str, row: &Row, old: Option<Row>) -> Value {
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

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::database::{open_store, prepare_store, read_offset};
    use crate::test_utils::{CannedRunner, row_json, stub_manifest, upsert_json};

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
