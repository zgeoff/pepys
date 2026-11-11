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
use crate::database::Store;
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
    #[must_use]
    pub fn new(store: &Store, scope: &str) -> Self {
        Self {
            connection: store.connection.clone(),
            scope: scope.to_owned(),
            handle: Handle::current(),
            read: Mutex::new(None),
        }
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

    store.connection.execute("BEGIN IMMEDIATE", ()).await?;

    let written = write_scope_batch(store, manifest, scope_kind, runner, stream, facts).await;

    match written {
        Ok(changes) => {
            write_offset_and_changes(&store.connection, stream, last.offset, &changes).await?;
            store.connection.execute("COMMIT", ()).await?;

            Ok(())
        }
        Err(error) => {
            store.connection.execute("ROLLBACK", ()).await?;

            Err(error)
        }
    }
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
        let source: Arc<dyn FactSource> = Arc::new(IndexFacts::new(store, &scope));
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
            runner: &mut ScopeCannedRunner,
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

        // The rows, links, change log rows and indexed facts of the file, and the stream's offset.
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
