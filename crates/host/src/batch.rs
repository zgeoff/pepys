use std::sync::Arc;

use pepys_schema::{GithubPullRequestDelete, GithubPullRequestOperation, GithubPullRequestUpsert};
use serde_json::{Value, json};
use tokio::runtime::Handle;
use turso::Connection;

use crate::consumer::ConsumerSpec;
use crate::database::Store;
use crate::error::HostError;
use crate::module_runner::RowSource;
use crate::pull_request_rows::{delete_row, load_row, write_row};

/// One record of the log: its sequence number and the fact JSON.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fact {
    pub seq_num: u64,
    pub body: String,
}

/// Runs a consumer on one fact and returns its operations as JSON.
pub trait FactRunner {
    /// # Errors
    /// Fails when the consumer cannot run or traps.
    fn apply_fact(&mut self, fact: &str, rows: Arc<dyn RowSource>) -> Result<String, HostError>;
}

/// Serves a consumer's reads from its own file, inside the batch's open transaction.
pub struct StoreRows {
    connection: Connection,
    handle: Handle,
}

impl StoreRows {
    #[must_use]
    pub fn new(store: &Store) -> Self {
        Self {
            connection: store.connection.clone(),
            handle: Handle::current(),
        }
    }
}

impl RowSource for StoreRows {
    fn read_row(&self, key: &str) -> Result<Option<Vec<u8>>, HostError> {
        // The module calls this from inside the runtime's thread, so the read runs on a blocking
        // slot of the multi-thread runtime.
        tokio::task::block_in_place(|| {
            self.handle.block_on(async {
                load_row(&self.connection, key)
                    .await?
                    .map(|row| serde_json::to_vec(&row))
                    .transpose()
                    .map_err(HostError::from)
            })
        })
    }
}

/// Applies the facts as one batch: the operations the consumer returns for each, the new offset and
/// one change log row commit together, or nothing is written. A batch whose operations change
/// nothing writes the offset and no change log row.
///
/// # Errors
/// Fails, after rolling the batch back, when the consumer fails, returns an operation on a table
/// it does not own, or a write fails.
pub async fn apply_batch(
    store: &Store,
    spec: &ConsumerSpec,
    runner: &mut dyn FactRunner,
    facts: &[Fact],
) -> Result<(), HostError> {
    let Some(last) = facts.last() else {
        return Ok(());
    };

    store.connection.execute("BEGIN IMMEDIATE", ()).await?;

    match write_batch(store, spec, runner, facts, last.seq_num).await {
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
    spec: &ConsumerSpec,
    runner: &mut dyn FactRunner,
    facts: &[Fact],
    last_seq_num: u64,
) -> Result<(), HostError> {
    let rows: Arc<dyn RowSource> = Arc::new(StoreRows::new(store));
    let mut changes: Vec<Value> = Vec::new();

    for fact in facts {
        let output = runner.apply_fact(&fact.body, Arc::clone(&rows))?;
        let operations = parse_operations(spec, &output)?;

        for operation in operations {
            changes.push(apply_operation(&store.connection, operation).await?);
        }
    }

    let last = i64::try_from(last_seq_num).map_err(|_| HostError::OutOfBounds)?;

    store
        .connection
        .execute(
            "INSERT OR REPLACE INTO offsets (stream, last_seq_num) VALUES (?1, ?2)",
            vec![turso::Value::from(spec.stream), turso::Value::from(last)],
        )
        .await?;

    if !changes.is_empty() {
        store
            .connection
            .execute(
                "INSERT INTO change_log (batch, changes) VALUES (?1, ?2)",
                vec![
                    turso::Value::from(last),
                    turso::Value::from(serde_json::to_string(&changes)?),
                ],
            )
            .await?;
    }

    Ok(())
}

// The ownership check reads the table names off the JSON before the typed parse, so a table the
// consumer does not own is refused as such and not as a malformed operation.
fn parse_operations(
    spec: &ConsumerSpec,
    output: &str,
) -> Result<Vec<GithubPullRequestOperation>, HostError> {
    let Value::Array(operations) = serde_json::from_str::<Value>(output)? else {
        return Err(HostError::BadOperation(
            "the output is not a list".to_owned(),
        ));
    };

    for operation in &operations {
        let tables = operation
            .as_object()
            .into_iter()
            .flat_map(|verbs| verbs.values())
            .filter_map(Value::as_object)
            .flat_map(|by_table| by_table.keys());

        for table in tables {
            if !spec.tables.contains(&table.as_str()) {
                return Err(HostError::NotOwned {
                    table: table.clone(),
                });
            }
        }
    }

    operations
        .into_iter()
        .map(|operation| {
            serde_json::from_value(operation)
                .map_err(|error| HostError::BadOperation(error.to_string()))
        })
        .collect()
}

async fn apply_operation(
    connection: &Connection,
    operation: GithubPullRequestOperation,
) -> Result<Value, HostError> {
    match operation {
        GithubPullRequestOperation::Upsert(upsert) => {
            let GithubPullRequestUpsert::GithubPullRequest(row) = *upsert;
            let old = load_row(connection, &row.id).await?;

            write_row(connection, &row).await?;

            let mut message = json!({
                "type": crate::pull_request_rows::TABLE,
                "key": row.id,
                "value": row,
                "headers": {"operation": if old.is_some() { "update" } else { "insert" }},
            });

            if let (Some(old), Some(object)) = (old, message.as_object_mut()) {
                object.insert("old_value".to_owned(), serde_json::to_value(old)?);
            }

            Ok(message)
        }
        GithubPullRequestOperation::Delete(delete) => {
            let GithubPullRequestDelete::GithubPullRequest(key) = delete;
            let old = load_row(connection, &key.id).await?;

            delete_row(connection, &key).await?;

            let mut message = json!({
                "type": crate::pull_request_rows::TABLE,
                "key": key.id,
                "headers": {"operation": "delete"},
            });

            if let (Some(old), Some(object)) = (old, message.as_object_mut()) {
                object.insert("old_value".to_owned(), serde_json::to_value(old)?);
            }

            Ok(message)
        }
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use crate::consumer::find_consumer;
    use crate::database::{open_store, prepare_store, read_offset};

    /// Returns the operations JSON the test lists for a fact body, or fails the fact.
    struct CannedRunner {
        outputs: HashMap<String, Result<String, String>>,
    }

    impl FactRunner for CannedRunner {
        fn apply_fact(
            &mut self,
            fact: &str,
            _rows: Arc<dyn RowSource>,
        ) -> Result<String, HostError> {
            match self.outputs.get(fact) {
                Some(Ok(output)) => Ok(output.clone()),
                Some(Err(message)) => Err(HostError::Panicked(message.clone())),
                None => Ok("[]".to_owned()),
            }
        }
    }

    fn row_json(id: &str, title: &str) -> Value {
        json!({
            "id": id, "number": 3, "repository_id": "github:repo:9", "title": title,
            "state": "open", "is_draft": false, "is_merged": false, "author_id": null,
            "url": "https://github.example/acme/harbour/pull/3", "merge_commit_sha": null,
            "created_at": "2026-10-01T09:00:00Z", "updated_at": "2026-10-01T09:00:00Z",
            "closed_at": null, "merged_at": null, "payload": {"k": 1}
        })
    }

    fn upsert(id: &str, title: &str) -> String {
        json!([{"upsert": {"github_pull_request": row_json(id, title)}}]).to_string()
    }

    async fn setup() -> (tempfile::TempDir, Store, &'static ConsumerSpec) {
        let directory = tempfile::tempdir().expect("a temporary directory");
        let spec = find_consumer("github_pull_request").expect("the consumer");
        let store = open_store(&directory.path().join("consumer.db"))
            .await
            .expect("a store");

        prepare_store(&store, spec.schema)
            .await
            .expect("the schema");

        (directory, store, spec)
    }

    fn runner(outputs: &[(&str, Result<String, String>)]) -> CannedRunner {
        CannedRunner {
            outputs: outputs
                .iter()
                .map(|(fact, output)| ((*fact).to_owned(), output.clone()))
                .collect(),
        }
    }

    fn fact(seq_num: u64, body: &str) -> Fact {
        Fact {
            seq_num,
            body: body.to_owned(),
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
        let (_directory, store, spec) = setup().await;
        let mut canned = runner(&[("a", Ok(upsert("github:pr:1", "First")))]);

        apply_batch(&store, spec, &mut canned, &[fact(4, "a")])
            .await
            .expect("the batch applies");

        assert_eq!(
            (
                count_rows(&store).await,
                read_offset(&store, spec.stream).await.expect("an offset"),
                change_log(&store).await,
            ),
            (
                1,
                Some(4),
                vec![(
                    4,
                    json!([{
                        "type": "github_pull_request",
                        "key": "github:pr:1",
                        "value": row_json("github:pr:1", "First"),
                        "headers": {"operation": "insert"}
                    }])
                )]
            )
        );
    }

    #[tokio::test]
    async fn it_logs_an_update_with_the_old_value_for_a_key_that_exists() {
        let (_directory, store, spec) = setup().await;
        let mut canned = runner(&[
            ("a", Ok(upsert("github:pr:1", "First"))),
            ("b", Ok(upsert("github:pr:1", "Second"))),
        ]);

        apply_batch(&store, spec, &mut canned, &[fact(0, "a")])
            .await
            .expect("the first batch applies");
        apply_batch(&store, spec, &mut canned, &[fact(1, "b")])
            .await
            .expect("the second batch applies");

        assert_eq!(
            change_log(&store).await[1],
            (
                1,
                json!([{
                    "type": "github_pull_request",
                    "key": "github:pr:1",
                    "value": row_json("github:pr:1", "Second"),
                    "old_value": row_json("github:pr:1", "First"),
                    "headers": {"operation": "update"}
                }])
            )
        );
    }

    #[tokio::test]
    async fn it_logs_an_insert_then_an_update_for_a_key_written_twice_in_one_batch() {
        let (_directory, store, spec) = setup().await;
        let mut canned = runner(&[
            ("a", Ok(upsert("github:pr:1", "First"))),
            ("b", Ok(upsert("github:pr:1", "Second"))),
        ]);

        apply_batch(&store, spec, &mut canned, &[fact(0, "a"), fact(1, "b")])
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
    async fn it_deletes_a_row_and_logs_the_old_value() {
        let (_directory, store, spec) = setup().await;
        let delete =
            json!([{"delete": {"github_pull_request": {"id": "github:pr:1"}}}]).to_string();
        let mut canned = runner(&[("a", Ok(upsert("github:pr:1", "First"))), ("b", Ok(delete))]);

        apply_batch(&store, spec, &mut canned, &[fact(0, "a")])
            .await
            .expect("the first batch applies");
        apply_batch(&store, spec, &mut canned, &[fact(1, "b")])
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
                    1,
                    json!([{
                        "type": "github_pull_request",
                        "key": "github:pr:1",
                        "old_value": row_json("github:pr:1", "First"),
                        "headers": {"operation": "delete"}
                    }])
                )
            )
        );
    }

    #[tokio::test]
    async fn it_writes_the_offset_and_no_change_log_row_for_a_batch_that_changes_nothing() {
        let (_directory, store, spec) = setup().await;
        let mut canned = runner(&[]);

        apply_batch(&store, spec, &mut canned, &[fact(7, "a")])
            .await
            .expect("the batch applies");

        assert_eq!(
            (
                read_offset(&store, spec.stream).await.expect("an offset"),
                change_log(&store).await.len()
            ),
            (Some(7), 0)
        );
    }

    #[tokio::test]
    async fn it_rejects_an_operation_on_a_table_the_consumer_does_not_own_and_writes_nothing() {
        let (_directory, store, spec) = setup().await;
        let foreign = json!([{"upsert": {"someone_elses_table": {"id": "x"}}}]).to_string();
        let mut canned = runner(&[
            ("a", Ok(upsert("github:pr:1", "First"))),
            ("b", Ok(foreign)),
        ]);

        let result = apply_batch(&store, spec, &mut canned, &[fact(0, "a"), fact(1, "b")]).await;

        assert_eq!(
            (
                result.map_err(|error| error.to_string()),
                count_rows(&store).await,
                read_offset(&store, spec.stream).await.expect("an offset"),
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
        let (_directory, store, spec) = setup().await;
        let mut canned = runner(&[
            ("a", Ok(upsert("github:pr:1", "First"))),
            ("b", Err("boom".to_owned())),
        ]);

        let result = apply_batch(&store, spec, &mut canned, &[fact(0, "a"), fact(1, "b")]).await;

        assert_eq!(
            (
                result.is_err(),
                count_rows(&store).await,
                read_offset(&store, spec.stream).await.expect("an offset"),
            ),
            (true, 0, None)
        );
    }
}
