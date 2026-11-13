//! A scope-mode batch: the scope twin of the fact-mode batch. The host indexes the batch's facts,
//! calls the module once per dirty scope with a read bounded to that scope, and replaces each
//! scope by a diff, all in one transaction.

use std::collections::BTreeSet;
use std::sync::{Arc, Mutex};

use serde::Deserialize;
use serde_json::Value;
use tokio::runtime::Handle;
use turso::Connection;

use crate::batch::write_offset_and_changes;
use crate::consumer::ConsumerManifest;
use crate::database::{Store, with_transaction};
use crate::entity_ids::kind_of;
use crate::error::HostError;
use crate::fact_index::{index_facts, read_entity_facts};
use crate::fact_log::StoredFact;
use crate::scope_replace::replace_scope;

/// Runs a scope consumer on one scope and returns its operations as JSON.
pub trait ScopeRunner: Send {
    /// # Errors
    /// Fails when the consumer cannot run or traps.
    fn apply_scope(&mut self, scope: &str, facts: Arc<dyn FactSource>)
    -> Result<String, HostError>;
}

/// Serves the one read of a scope consumer: every fact of the scope's entity.
pub trait FactSource: Send + Sync {
    /// The facts of `scope` as one JSON list.
    ///
    /// # Errors
    /// Fails with [`HostError::ForeignScopeRead`] for a scope other than the one the module was
    /// called for, and when the index cannot be read.
    fn read_scope_facts(&self, scope: &str) -> Result<Vec<u8>, HostError>;
}

/// Serves the facts of one scope from the consumer file's index, inside the batch's open
/// transaction. It refuses every other scope.
pub struct IndexFacts {
    connection: Connection,
    scope: String,
    handle: Handle,
    // The module reads twice, for the length and then the bytes, so the second read reuses the
    // first.
    read: Mutex<Option<Vec<u8>>>,
}

impl IndexFacts {
    /// # Errors
    /// Fails when it is called outside a tokio runtime.
    pub fn new(store: &Store, scope: &str) -> Result<Self, HostError> {
        Ok(Self {
            connection: store.connection.clone(),
            scope: scope.to_owned(),
            handle: Handle::try_current()?,
            read: Mutex::new(None),
        })
    }
}

impl FactSource for IndexFacts {
    fn read_scope_facts(&self, scope: &str) -> Result<Vec<u8>, HostError> {
        if scope != self.scope {
            return Err(HostError::ForeignScopeRead {
                scope: self.scope.clone(),
                asked: scope.to_owned(),
            });
        }

        let mut read = self
            .read
            .lock()
            .map_err(|_| HostError::Config("a read of the scope's facts panicked".to_owned()))?;

        if let Some(bytes) = read.as_ref() {
            return Ok(bytes.clone());
        }

        // The module calls this from inside the runtime's thread, so the read runs on a blocking
        // slot of the multi-thread runtime.
        let text = tokio::task::block_in_place(|| {
            self.handle
                .block_on(read_entity_facts(&self.connection, &self.scope))
        })?;
        let bytes = text.into_bytes();

        *read = Some(bytes.clone());

        Ok(bytes)
    }
}

/// Applies facts of one stream as one scope batch: the index of the facts, each dirty scope's
/// replace, the stream's new offset and one change log row commit together, or nothing is
/// written. A batch whose scopes change nothing writes the index and the offset alone.
///
/// # Errors
/// Fails, after rolling the batch back, when the consumer fails, returns an operation the scope
/// replace refuses, or a write fails.
pub async fn apply_scope_batch(
    store: &Store,
    manifest: &ConsumerManifest,
    scope_kind: &str,
    runner: &mut dyn ScopeRunner,
    stream: &str,
    facts: &[StoredFact],
) -> Result<(), HostError> {
    let Some(last) = facts.last() else {
        return Ok(());
    };

    with_transaction(&store.connection, async {
        let changes = write_scope_batch(store, manifest, scope_kind, runner, stream, facts).await?;

        write_offset_and_changes(&store.connection, stream, last.offset, &changes).await
    })
    .await
}

async fn write_scope_batch(
    store: &Store,
    manifest: &ConsumerManifest,
    scope_kind: &str,
    runner: &mut dyn ScopeRunner,
    stream: &str,
    facts: &[StoredFact],
) -> Result<Vec<Value>, HostError> {
    index_facts(&store.connection, stream, facts).await?;

    let mut changes = Vec::new();

    for scope in collect_dirty_scopes(scope_kind, facts) {
        let source: Arc<dyn FactSource> = Arc::new(IndexFacts::new(store, &scope)?);
        let output = runner.apply_scope(&scope, source)?;

        changes.extend(replace_scope(&store.connection, manifest, &scope, &output).await?);
    }

    Ok(changes)
}

#[derive(Deserialize)]
struct FactEntity {
    entity: String,
}

/// The entities of the facts that have the consumer's scope kind, each once, in sorted order. A
/// copy of a fact marks its scope dirty too, and the replace then finds no change.
#[must_use]
pub fn collect_dirty_scopes(scope_kind: &str, facts: &[StoredFact]) -> BTreeSet<String> {
    facts
        .iter()
        .filter_map(|fact| serde_json::from_str::<FactEntity>(&fact.body).ok())
        .map(|fact| fact.entity)
        .filter(|entity| kind_of(entity) == Some(scope_kind))
        .collect()
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::database::{open_store, prepare_scope_tables, prepare_store, read_offset};
    use crate::test_utils::{ScopeCannedRunner, stub_scope_manifest};

    const STREAM: &str = "facts.ledger.account";

    struct TestScope {
        _directory: tempfile::TempDir,
        store: Store,
        manifest: ConsumerManifest,
    }

    async fn setup_test() -> TestScope {
        let directory = tempfile::tempdir().expect("a directory");
        let manifest = stub_scope_manifest();
        let store = open_store(&directory.path().join("consumer.db"))
            .await
            .expect("a store");

        prepare_store(&store, &manifest.schema)
            .await
            .expect("the tables");
        prepare_scope_tables(&store)
            .await
            .expect("the scope tables");

        TestScope {
            _directory: directory,
            store,
            manifest,
        }
    }

    impl TestScope {
        async fn apply(
            &self,
            runner: &mut dyn ScopeRunner,
            facts: &[StoredFact],
        ) -> Result<(), HostError> {
            apply_scope_batch(
                &self.store,
                &self.manifest,
                "ledger:account",
                runner,
                STREAM,
                facts,
            )
            .await
        }

        async fn count(&self, table: &str) -> i64 {
            let mut rows = self
                .store
                .connection
                .query(&format!("SELECT count(*) FROM {table}"), ())
                .await
                .expect("a count");

            rows.next()
                .await
                .expect("a row")
                .expect("a count row")
                .get(0)
                .expect("an integer")
        }

        async fn read_counts(&self) -> (i64, i64, i64, i64, Option<u64>) {
            (
                self.count("ledger_account").await + self.count("ledger_entry").await,
                self.count("link").await,
                self.count("change_log").await,
                self.count("scope_fact").await,
                read_offset(&self.store, STREAM).await.expect("an offset"),
            )
        }
    }

    fn fact(offset: u64, id: &str, entity: &str) -> StoredFact {
        StoredFact {
            offset,
            body: json!({"id": id, "entity": entity, "at": "2026-11-01T09:00:00Z"}).to_string(),
            appended_at_ms: 0,
        }
    }

    fn account_output(account: &str) -> String {
        json!([{"upsert": {"ledger_account": {
            "id": account, "name": "Alpha", "balance": 5, "is_closed": false,
            "opened_at": null, "updated_at": "2026-11-01T09:00:00Z"
        }}}])
        .to_string()
    }

    fn entry_output(account: &str) -> String {
        json!([
            {"upsert": {"ledger_entry": {
                "id": "ledger:entry:e1", "account_id": account, "amount": 5, "rate": 1,
                "memo": "Rope", "details": {}, "posted_at": "2026-11-01T09:00:00Z"
            }}},
            {"link": {
                "type": "entry_of", "from": "ledger:entry:e1", "to": account,
                "confidence": 1, "evidence": "event:ledger:1"
            }}
        ])
        .to_string()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_rolls_the_batch_back_when_the_change_log_write_fails() {
        let ctx = setup_test().await;
        let mut runner =
            ScopeCannedRunner::new(&[("ledger:account:a", Ok(account_output("ledger:account:a")))]);

        ctx.store
            .connection
            .execute("DROP TABLE change_log", ())
            .await
            .expect("the drop");

        let result = ctx
            .apply(
                &mut runner,
                &[fact(0, "event:ledger:1", "ledger:account:a")],
            )
            .await;

        assert!(result.is_err());
        assert_eq!(
            (
                ctx.count("ledger_account").await,
                ctx.count("scope_fact").await,
                read_offset(&ctx.store, STREAM).await.expect("an offset"),
            ),
            (0, 0, None)
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_changes_no_row_no_link_and_no_change_log_row_for_a_fact_twice() {
        let ctx = setup_test().await;
        let mut runner =
            ScopeCannedRunner::new(&[("ledger:account:a", Ok(entry_output("ledger:account:a")))]);

        ctx.apply(
            &mut runner,
            &[fact(0, "event:ledger:1", "ledger:account:a")],
        )
        .await
        .expect("the first batch");

        ctx.apply(
            &mut runner,
            &[fact(1, "event:ledger:1", "ledger:account:a")],
        )
        .await
        .expect("the copy");

        assert_eq!(ctx.read_counts().await, (1, 1, 1, 1, Some(1)));
        assert_eq!(runner.read[0], runner.read[1]);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_gives_the_module_the_facts_of_its_scope_only() {
        let ctx = setup_test().await;
        let first = fact(0, "event:ledger:1", "ledger:account:a");
        let mut runner = ScopeCannedRunner::new(&[]);

        ctx.apply(
            &mut runner,
            &[first.clone(), fact(1, "event:ledger:2", "ledger:account:b")],
        )
        .await
        .expect("a batch");

        assert_eq!(runner.read[0], format!("[{}]", first.body));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_refuses_a_read_of_another_scope_and_leaves_nothing_of_the_batch() {
        let ctx = setup_test().await;
        let mut runner =
            ScopeCannedRunner::new(&[]).reading("ledger:account:a", "ledger:account:b");

        let result = ctx
            .apply(
                &mut runner,
                &[
                    fact(0, "event:ledger:1", "ledger:account:a"),
                    fact(1, "event:ledger:2", "ledger:account:b"),
                ],
            )
            .await;

        assert_eq!(
            result.map_err(|error| error.to_string()),
            Err(
                "the module of scope ledger:account:a read the facts of ledger:account:b"
                    .to_owned()
            )
        );
        assert_eq!(ctx.read_counts().await, (0, 0, 0, 0, None));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_stops_the_batch_on_a_row_that_another_scope_owns_and_leaves_nothing_of_it() {
        let ctx = setup_test().await;
        let mut runner = ScopeCannedRunner::new(&[
            ("ledger:account:a", Ok(entry_output("ledger:account:a"))),
            ("ledger:account:b", Ok(entry_output("ledger:account:b"))),
        ]);

        ctx.apply(
            &mut runner,
            &[fact(0, "event:ledger:1", "ledger:account:a")],
        )
        .await
        .expect("the first batch");

        let result = ctx
            .apply(
                &mut runner,
                &[fact(1, "event:ledger:2", "ledger:account:b")],
            )
            .await;

        assert!(
            matches!(
                &result,
                Err(HostError::ScopeConflict { scope, owner: Some(owner), .. })
                    if scope == "ledger:account:b" && owner == "ledger:account:a"
            ),
            "{result:?}"
        );
        assert_eq!(ctx.read_counts().await, (1, 1, 1, 1, Some(0)));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_rolls_the_first_scope_back_when_the_second_of_two_dirty_scopes_fails() {
        let ctx = setup_test().await;
        let mut runner = ScopeCannedRunner::new(&[
            ("ledger:account:a", Ok(account_output("ledger:account:a"))),
            ("ledger:account:b", Err("a trap".to_owned())),
        ]);

        let result = ctx
            .apply(
                &mut runner,
                &[
                    fact(0, "event:ledger:1", "ledger:account:b"),
                    fact(1, "event:ledger:2", "ledger:account:a"),
                ],
            )
            .await;

        assert_eq!(
            (result.map_err(|error| error.to_string()), runner.read.len()),
            (Err("the consumer panicked: a trap".to_owned()), 2)
        );
        assert_eq!(ctx.read_counts().await, (0, 0, 0, 0, None));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_refuses_a_delete_from_a_scope_consumer_and_leaves_nothing_of_the_batch() {
        let ctx = setup_test().await;
        let delete = json!([{"delete": {"ledger_account": {"id": "ledger:account:a"}}}]);
        let mut runner = ScopeCannedRunner::new(&[("ledger:account:a", Ok(delete.to_string()))]);

        let result = ctx
            .apply(
                &mut runner,
                &[fact(0, "event:ledger:1", "ledger:account:a")],
            )
            .await;

        assert!(
            matches!(&result, Err(HostError::BadOperation(_))),
            "{result:?}"
        );
        assert_eq!(ctx.read_counts().await, (0, 0, 0, 0, None));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_writes_the_offset_alone_for_a_fact_of_no_scope() {
        let ctx = setup_test().await;
        let mut runner = ScopeCannedRunner::new(&[]);

        ctx.apply(&mut runner, &[fact(0, "event:ledger:1", "ledger:entry:e1")])
            .await
            .expect("a batch");

        assert_eq!(
            (ctx.read_counts().await, runner.read.len()),
            ((0, 0, 0, 1, Some(0)), 0)
        );
    }

    /// A module whose account row takes the name and time of the last fact its scope read gives,
    /// so the rows depend on the order of that read.
    struct LastNameRunner;

    impl ScopeRunner for LastNameRunner {
        fn apply_scope(
            &mut self,
            scope: &str,
            facts: Arc<dyn FactSource>,
        ) -> Result<String, HostError> {
            let read: Vec<Value> = serde_json::from_slice(&facts.read_scope_facts(scope)?)?;
            let last = read.last().ok_or(HostError::OutOfBounds)?;

            Ok(json!([{"upsert": {"ledger_account": {
                "id": scope, "name": last["name"], "balance": read.len(), "is_closed": false,
                "opened_at": null, "updated_at": last["at"]
            }}}])
            .to_string())
        }
    }

    fn named_fact(id: &str, entity: &str, at: &str, name: &str) -> String {
        json!({"id": id, "entity": entity, "at": at, "name": name}).to_string()
    }

    impl TestScope {
        /// Applies each body as its own batch, numbered in the order given, and reads back every
        /// account row as its id, name, balance and update time.
        async fn apply_one_by_one(&self, bodies: &[String]) -> Vec<(String, String, i64, String)> {
            for (offset, body) in (0_u64..).zip(bodies) {
                let fact = StoredFact {
                    offset,
                    body: body.clone(),
                    appended_at_ms: 0,
                };

                self.apply(&mut LastNameRunner, &[fact])
                    .await
                    .expect("a batch");
            }

            let mut rows = self
                .store
                .connection
                .query(
                    "SELECT id, name, balance, updated_at FROM ledger_account ORDER BY id",
                    (),
                )
                .await
                .expect("the rows");
            let mut accounts = Vec::new();

            while let Some(row) = rows.next().await.expect("a row") {
                accounts.push((
                    row.get(0).expect("an id"),
                    row.get(1).expect("a name"),
                    row.get(2).expect("a balance"),
                    row.get(3).expect("a time"),
                ));
            }

            accounts
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn it_gives_the_same_rows_for_facts_with_distinct_times_in_either_arrival_order() {
        let given = setup_test().await;
        let reversed = setup_test().await;
        let facts = [
            named_fact(
                "event:ledger:1",
                "ledger:account:a",
                "2026-11-01T09:00:00Z",
                "Harbour",
            ),
            named_fact(
                "event:ledger:2",
                "ledger:account:a",
                "2026-11-01T09:30:00Z",
                "Quay",
            ),
            named_fact(
                "event:ledger:3",
                "ledger:account:a",
                "2026-11-01T09:10:00.5Z",
                "Pier",
            ),
            named_fact(
                "event:ledger:4",
                "ledger:account:b",
                "2026-11-01T09:05:00Z",
                "Reef",
            ),
        ];
        let backwards: Vec<String> = facts.iter().rev().cloned().collect();

        let rows = (
            given.apply_one_by_one(&facts).await,
            reversed.apply_one_by_one(&backwards).await,
        );

        let expected = vec![
            (
                "ledger:account:a".to_owned(),
                "Quay".to_owned(),
                3,
                "2026-11-01T09:30:00Z".to_owned(),
            ),
            (
                "ledger:account:b".to_owned(),
                "Reef".to_owned(),
                1,
                "2026-11-01T09:05:00Z".to_owned(),
            ),
        ];

        assert_eq!(rows, (expected.clone(), expected));
    }

    #[test]
    fn it_marks_each_scope_dirty_once_in_sorted_order() {
        let facts = [
            fact(0, "event:ledger:1", "ledger:account:b"),
            fact(1, "event:ledger:2", "ledger:entry:e1"),
            fact(2, "event:ledger:3", "ledger:account:a"),
            fact(3, "event:ledger:4", "ledger:account:b"),
        ];

        assert_eq!(
            collect_dirty_scopes("ledger:account", &facts)
                .into_iter()
                .collect::<Vec<String>>(),
            vec!["ledger:account:a".to_owned(), "ledger:account:b".to_owned()]
        );
    }
}
