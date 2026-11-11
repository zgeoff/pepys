//! The scope replace: one scope's result against what the scope owns, as a diff. The host writes
//! each returned row and link that is new or differs, with the scope as its owner, and deletes each
//! row and link that the scope owned and did not return.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;
use turso::Connection;

use crate::batch::{build_row_delete_entry, build_write_entry};
use crate::consumer::ConsumerManifest;
use crate::error::HostError;
use crate::links::{
    Link, LinkEnds, StoredLink, build_link_delete_entry, build_link_key, build_link_write_entry,
    delete_link, find_link_problem, load_scope_links, load_stored_link, write_link,
};
use crate::operations::{WireOperation, parse_wire, table_info};
use crate::rows::{Row, check_row, delete_row, key_of, load_row, write_row};

/// A row of the consumer by its table and its key.
pub type RowID = (String, String);

/// A link by its type, `from` and `to`.
pub type LinkID = (String, String, String);

/// What one scope returned, checked and keyed.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ScopeResult {
    pub rows: BTreeMap<RowID, Row>,
    pub links: BTreeMap<LinkID, Link>,
}

/// What the consumer file holds that the replace of one scope needs.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ScopeState {
    /// The owner of each row that the result names or that the scope owns, when a scope owns it.
    pub row_owners: BTreeMap<RowID, String>,
    /// The stored row of each key that the result names or that the scope owns.
    pub stored_rows: BTreeMap<RowID, Row>,
    /// The stored link of each key that the result names or that the scope owns.
    pub stored_links: BTreeMap<LinkID, StoredLink>,
}

/// The writes and deletes of one scope, with their change entries in order.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ScopeChanges {
    pub written_rows: Vec<(RowID, Row)>,
    pub written_links: Vec<Link>,
    pub deleted_rows: Vec<RowID>,
    pub deleted_links: Vec<LinkEnds>,
    pub entries: Vec<Value>,
}

/// Replaces one scope from the module's output text, inside the caller's transaction, and returns
/// its change entries. The caller rolls the batch back on an error.
///
/// # Errors
/// Fails with the refusal of [`collect_scope_result`] or [`pick_scope_changes`], or when a read or
/// a write fails.
pub async fn replace_scope(
    connection: &Connection,
    manifest: &ConsumerManifest,
    scope: &str,
    output: &str,
) -> Result<Vec<Value>, HostError> {
    let result = collect_scope_result(manifest, scope, parse_wire(manifest, output)?)?;
    let state = read_scope_state(connection, manifest, scope, &result).await?;
    let changes = pick_scope_changes(scope, &result, &state)?;

    write_scope_changes(connection, manifest, scope, &changes).await?;

    Ok(changes.entries)
}

/// Checks one scope's operations in the test store's order: no delete or unlink, every link, each
/// row with its key, then each link key.
///
/// # Errors
/// Fails with [`HostError::BadOperation`] for a delete or an unlink, [`HostError::BadLink`],
/// [`HostError::BadRow`], [`HostError::DuplicateRow`] or [`HostError::DuplicateLink`].
pub fn collect_scope_result(
    manifest: &ConsumerManifest,
    scope: &str,
    operations: Vec<WireOperation>,
) -> Result<ScopeResult, HostError> {
    let mut upserts = Vec::new();
    let mut links = Vec::new();

    for operation in operations {
        match operation {
            WireOperation::Upsert { table, row } => upserts.push((table, row)),
            WireOperation::Link(link) => links.push(link),
            WireOperation::Delete { .. } => {
                return Err(HostError::BadOperation(
                    "a scope consumer returned a delete".to_owned(),
                ));
            }
            WireOperation::Unlink(_) => {
                return Err(HostError::BadOperation(
                    "a scope consumer returned an unlink".to_owned(),
                ));
            }
        }
    }

    if let Some(problem) = links
        .iter()
        .find_map(|link| find_link_problem(&manifest.links, link))
    {
        return Err(HostError::BadLink(problem));
    }

    let mut result = ScopeResult::default();

    for (table, row) in upserts {
        let info = table_info(manifest, &table)?;

        check_row(&table, info, &row)?;

        let key = key_of(&table, info, &row)?;

        if result.rows.contains_key(&(table.clone(), key.clone())) {
            return Err(HostError::DuplicateRow {
                scope: scope.to_owned(),
                table,
                key,
            });
        }

        result.rows.insert((table, key), row);
    }

    for link in links {
        let id = to_link_id(&link);

        if result.links.contains_key(&id) {
            return Err(HostError::DuplicateLink {
                scope: scope.to_owned(),
                key: build_link_key(&id.0, &id.1, &id.2),
            });
        }

        result.links.insert(id, link);
    }

    Ok(result)
}

fn to_link_id(link: &Link) -> LinkID {
    (link.link_type.clone(), link.from.clone(), link.to.clone())
}

/// Reads the owners and stored values of each row and link that the result names or that the
/// scope owns.
///
/// # Errors
/// Fails when a query fails.
pub async fn read_scope_state(
    connection: &Connection,
    manifest: &ConsumerManifest,
    scope: &str,
    result: &ScopeResult,
) -> Result<ScopeState, HostError> {
    let mut state = ScopeState::default();
    let mut wanted: BTreeSet<RowID> = result.rows.keys().cloned().collect();

    for id in read_owned_rows(connection, scope).await? {
        wanted.insert(id);
    }

    for (table, key) in wanted {
        if let Some(owner) = read_row_owner(connection, &table, &key).await? {
            state.row_owners.insert((table.clone(), key.clone()), owner);
        }

        // A table that a scope owned a row of and that the manifest no longer declares cannot
        // occur: a new manifest is a new version with a new file.
        let info = table_info(manifest, &table)?;

        if let Some(row) = load_row(connection, &table, info, &key).await? {
            state.stored_rows.insert((table, key), row);
        }
    }

    for link in result.links.values() {
        if let Some(stored) = load_stored_link(connection, &link.to_ends()).await? {
            state.stored_links.insert(to_link_id(link), stored);
        }
    }

    for link in load_scope_links(connection, scope).await? {
        state.stored_links.insert(
            to_link_id(&link),
            StoredLink {
                scope: Some(scope.to_owned()),
                link,
            },
        );
    }

    Ok(state)
}

async fn read_owned_rows(connection: &Connection, scope: &str) -> Result<Vec<RowID>, HostError> {
    let mut rows = connection
        .query(
            "SELECT table_name, key FROM scope_row WHERE scope = ?1",
            vec![turso::Value::from(scope)],
        )
        .await?;
    let mut owned = Vec::new();

    while let Some(row) = rows.next().await? {
        owned.push((row.get(0)?, row.get(1)?));
    }

    Ok(owned)
}

async fn read_row_owner(
    connection: &Connection,
    table: &str,
    key: &str,
) -> Result<Option<String>, HostError> {
    let mut rows = connection
        .query(
            "SELECT scope FROM scope_row WHERE table_name = ?1 AND key = ?2",
            vec![turso::Value::from(table), turso::Value::from(key)],
        )
        .await?;

    let Some(row) = rows.next().await? else {
        return Ok(None);
    };

    Ok(Some(row.get(0)?))
}

/// The replace of one scope as a diff. Nothing it returns may belong to another scope, and a link
/// that fact mode wrote belongs to none. The entries come as rows written, links written, rows
/// deleted and links deleted, each in key order.
///
/// # Errors
/// Fails with [`HostError::ScopeConflict`] for the first row, then the first link, in key order
/// that another scope owns.
pub fn pick_scope_changes(
    scope: &str,
    result: &ScopeResult,
    state: &ScopeState,
) -> Result<ScopeChanges, HostError> {
    if let Some(conflict) = find_conflict(scope, result, state) {
        return Err(conflict);
    }

    let mut changes = ScopeChanges::default();
    let mut row_entries = Vec::new();
    let mut link_entries = Vec::new();

    for (id, row) in &result.rows {
        let stored = state.stored_rows.get(id);
        if stored.is_some_and(|stored| is_same_value(stored, row)) {
            continue;
        }

        row_entries.push(build_write_entry(&id.0, &id.1, row, stored.cloned()));
        changes.written_rows.push((id.clone(), row.clone()));
    }

    for (id, link) in &result.links {
        let stored = state.stored_links.get(id).map(|stored| &stored.link);

        if stored.is_some_and(|stored| is_same_link(stored, link)) {
            continue;
        }

        link_entries.push(build_link_write_entry(link, stored));
        changes.written_links.push(link.clone());
    }

    let mut entries = row_entries;

    entries.append(&mut link_entries);

    for (id, owner) in &state.row_owners {
        if owner != scope || result.rows.contains_key(id) {
            continue;
        }

        if let Some(old) = state.stored_rows.get(id) {
            entries.push(build_row_delete_entry(&id.0, &id.1, old));
        }

        changes.deleted_rows.push(id.clone());
    }

    for (id, stored) in &state.stored_links {
        if stored.scope.as_deref() != Some(scope) || result.links.contains_key(id) {
            continue;
        }

        let ends = stored.link.to_ends();

        entries.push(build_link_delete_entry(&ends));
        changes.deleted_links.push(ends);
    }

    changes.entries = entries;

    Ok(changes)
}

fn find_conflict(scope: &str, result: &ScopeResult, state: &ScopeState) -> Option<HostError> {
    let row_conflict = result.rows.keys().find_map(|id| {
        let owner = state.row_owners.get(id)?;

        (owner != scope).then(|| HostError::ScopeConflict {
            scope: scope.to_owned(),
            table: id.0.clone(),
            key: id.1.clone(),
            owner: Some(owner.clone()),
        })
    });

    row_conflict.or_else(|| {
        result.links.keys().find_map(|id| {
            let stored = state.stored_links.get(id)?;

            (stored.scope.as_deref() != Some(scope)).then(|| HostError::ScopeConflict {
                scope: scope.to_owned(),
                table: "link".to_owned(),
                key: build_link_key(&id.0, &id.1, &id.2),
                owner: stored.scope.clone(),
            })
        })
    })
}

// A row as JSON, with every number compared as a float, so that a REAL column holds `2` and `2.0`
// as one value. The check of the row has refused a fraction in an integer column, and a stored
// integer never reads back with one.
fn is_same_value(stored: &Row, row: &Row) -> bool {
    stored.len() == row.len()
        && stored.iter().all(|(name, value)| {
            row.get(name)
                .is_some_and(|other| is_same_json(value, other))
        })
}

fn is_same_json(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => left.as_f64() == right.as_f64(),
        (Value::Array(left), Value::Array(right)) => {
            left.len() == right.len()
                && left
                    .iter()
                    .zip(right)
                    .all(|(left, right)| is_same_json(left, right))
        }
        (Value::Object(left), Value::Object(right)) => is_same_value(left, right),
        (left, right) => left == right,
    }
}

// A confidence is a float on both sides, so `1` and `1.0` are one value.
fn is_same_link(stored: &Link, link: &Link) -> bool {
    stored.confidence.total_cmp(&link.confidence).is_eq() && stored.evidence == link.evidence
}

/// Writes one scope's changes, with the scope as the owner of each row and link it writes.
///
/// # Errors
/// Fails when a statement fails.
pub async fn write_scope_changes(
    connection: &Connection,
    manifest: &ConsumerManifest,
    scope: &str,
    changes: &ScopeChanges,
) -> Result<(), HostError> {
    for ((table, key), row) in &changes.written_rows {
        write_row(connection, table, table_info(manifest, table)?, row).await?;
        connection
            .execute(
                "INSERT OR REPLACE INTO scope_row (table_name, key, scope) VALUES (?1, ?2, ?3)",
                vec![
                    turso::Value::from(table.as_str()),
                    turso::Value::from(key.as_str()),
                    turso::Value::from(scope),
                ],
            )
            .await?;
    }

    for link in &changes.written_links {
        write_link(connection, &manifest.name, Some(scope), link).await?;
    }

    for (table, key) in &changes.deleted_rows {
        delete_row(connection, table, table_info(manifest, table)?, key).await?;
        connection
            .execute(
                "DELETE FROM scope_row WHERE table_name = ?1 AND key = ?2",
                vec![
                    turso::Value::from(table.as_str()),
                    turso::Value::from(key.as_str()),
                ],
            )
            .await?;
    }

    for ends in &changes.deleted_links {
        delete_link(connection, ends).await?;
    }

    Ok(())
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde::Deserialize;
    use serde_json::{Value, json};

    use super::*;
    use crate::database::{Store, open_store, prepare_scope_tables, prepare_store};
    use crate::rows::load_all_rows;
    use crate::test_utils::stub_scope_manifest;

    const CASES: &str =
        include_str!("../../../packages/testing/src/scope-replace/scope-replace-cases.json");

    #[derive(Deserialize)]
    struct CaseFile {
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct Case {
        title: String,
        #[serde(default)]
        stored: Option<StoredLinks>,
        batches: Vec<CaseBatch>,
        rows: Value,
        links: Value,
    }

    #[derive(Deserialize)]
    struct StoredLinks {
        links: Vec<LinkRow>,
    }

    #[derive(Deserialize)]
    struct LinkRow {
        #[serde(rename = "type")]
        link_type: String,
        from_id: String,
        to_id: String,
        scope: Option<String>,
        origin: String,
        confidence: f64,
        evidence: String,
    }

    #[derive(Deserialize)]
    struct CaseBatch {
        scopes: Vec<CaseScope>,
        #[serde(default)]
        changes: Option<Value>,
        #[serde(default)]
        refused: Option<String>,
    }

    #[derive(Deserialize)]
    struct CaseScope {
        scope: String,
        output: String,
    }

    async fn open_case_store(directory: &tempfile::TempDir, manifest: &ConsumerManifest) -> Store {
        let store = open_store(&directory.path().join("consumer.db"))
            .await
            .expect("a store");

        prepare_store(&store, &manifest.schema)
            .await
            .expect("the tables");
        prepare_scope_tables(&store)
            .await
            .expect("the scope tables");

        store
    }

    // The refusal kinds of the case file.
    fn to_refusal_kind(error: &HostError) -> String {
        match error {
            HostError::BadOperation(_) => "bad-operation",
            HostError::NotOwned { .. } => "not-owned",
            HostError::BadRow { .. } => "bad-row",
            HostError::BadLink(_) => "bad-link",
            HostError::DuplicateRow { .. } => "duplicate-row",
            HostError::DuplicateLink { .. } => "duplicate-link",
            HostError::ScopeConflict { .. } => "scope-conflict",
            other @ (HostError::Database(_)
            | HostError::Module(_)
            | HostError::Json(_)
            | HostError::Io(_)
            | HostError::Stream(_)
            | HostError::UnknownStream(_)
            | HostError::MissingBlob(_)
            | HostError::BlobUnavailable(_)
            | HostError::MissingExport(_)
            | HostError::OutOfBounds
            | HostError::Panicked(_)
            | HostError::UnknownConsumer(_)
            | HostError::Transition { .. }
            | HostError::UnknownVersion(_)
            | HostError::Locked(_)
            | HostError::Config(_)
            | HostError::BadManifest { .. }
            | HostError::ModuleHash { .. }
            | HostError::SchemaMismatch { .. }
            | HostError::NoCurrentVersion(_)
            | HostError::VersionClash { .. }
            | HostError::TableOwned { .. }
            | HostError::ForeignScopeRead { .. }
            | HostError::Stopped { .. }
            | HostError::Up { .. }) => panic!("no refusal kind for {other}"),
        }
        .to_owned()
    }

    async fn run_case_batch(
        store: &Store,
        manifest: &ConsumerManifest,
        batch: &CaseBatch,
    ) -> Value {
        store
            .connection
            .execute("BEGIN IMMEDIATE", ())
            .await
            .expect("a transaction");

        let mut changes = Vec::new();

        for scope in &batch.scopes {
            match replace_scope(&store.connection, manifest, &scope.scope, &scope.output).await {
                Ok(entries) => changes.extend(entries),
                Err(error) => {
                    store
                        .connection
                        .execute("ROLLBACK", ())
                        .await
                        .expect("a rollback");

                    return json!({"refused": to_refusal_kind(&error)});
                }
            }
        }

        store
            .connection
            .execute("COMMIT", ())
            .await
            .expect("a commit");

        json!({"changes": changes})
    }

    async fn read_links(store: &Store) -> Value {
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
            links.push(json!({
                "type": row.get::<String>(0).expect("a type"),
                "from_id": row.get::<String>(1).expect("a from"),
                "to_id": row.get::<String>(2).expect("a to"),
                "scope": row.get::<Option<String>>(3).expect("a scope"),
                "origin": row.get::<String>(4).expect("an origin"),
                "confidence": row.get::<f64>(5).expect("a confidence"),
                "evidence": row.get::<String>(6).expect("an evidence"),
            }));
        }

        Value::Array(links)
    }

    // Every number as a float, so that the stored `1.0` of a REAL column or a confidence equals
    // the case file's `1`.
    fn to_float_numbers(value: Value) -> Value {
        match value {
            Value::Number(number) => number
                .as_f64()
                .and_then(serde_json::Number::from_f64)
                .map_or(Value::Null, Value::Number),
            Value::Array(items) => Value::Array(items.into_iter().map(to_float_numbers).collect()),
            Value::Object(fields) => Value::Object(
                fields
                    .into_iter()
                    .map(|(name, field)| (name, to_float_numbers(field)))
                    .collect(),
            ),
            other @ (Value::Null | Value::Bool(_) | Value::String(_)) => other,
        }
    }

    async fn run_case(case: &Case) -> Value {
        let directory = tempfile::tempdir().expect("a directory");
        let manifest = stub_scope_manifest();
        let store = open_case_store(&directory, &manifest).await;

        for link in case.stored.iter().flat_map(|stored| &stored.links) {
            write_link(
                &store.connection,
                &link.origin,
                link.scope.as_deref(),
                &Link {
                    link_type: link.link_type.clone(),
                    from: link.from_id.clone(),
                    to: link.to_id.clone(),
                    confidence: link.confidence,
                    evidence: link.evidence.clone(),
                },
            )
            .await
            .expect("a stored link");
        }

        let mut outcomes = Vec::new();

        for batch in &case.batches {
            outcomes.push(run_case_batch(&store, &manifest, batch).await);
        }

        let mut rows = serde_json::Map::new();

        for (table, info) in &manifest.tables {
            let stored = load_all_rows(&store.connection, table, info)
                .await
                .expect("the rows");

            rows.insert(
                table.clone(),
                Value::Array(stored.into_iter().map(Value::Object).collect()),
            );
        }

        to_float_numbers(json!({
            "outcomes": outcomes,
            "rows": rows,
            "links": read_links(&store).await,
        }))
    }

    fn build_expected(case: &Case) -> Value {
        let outcomes: Vec<Value> = case
            .batches
            .iter()
            .map(|batch| match (&batch.refused, &batch.changes) {
                (Some(kind), _) => json!({"refused": kind}),
                (None, changes) => json!({"changes": changes.clone().unwrap_or(json!([]))}),
            })
            .collect();

        to_float_numbers(json!({
            "outcomes": outcomes,
            "rows": case.rows,
            "links": case.links,
        }))
    }

    // The test store's TypeScript replace runs the same cases, so the two replaces cannot drift
    // apart unseen.
    #[tokio::test]
    async fn it_gives_each_shared_scope_replace_case_its_outcome_rows_and_links() {
        let file: CaseFile = serde_json::from_str(CASES).expect("the cases");
        let mut wrong = Vec::new();

        for case in &file.cases {
            let received = run_case(case).await;
            let expected = build_expected(case);

            if received != expected {
                wrong.push(format!(
                    "{}\n  received {received}\n  expected {expected}",
                    case.title
                ));
            }
        }

        assert!(wrong.is_empty(), "{}", wrong.join("\n"));
    }
}
