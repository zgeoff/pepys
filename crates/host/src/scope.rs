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
