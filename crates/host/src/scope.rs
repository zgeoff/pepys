//! SPIKE. Scope mode (design parts D scope.rs, F3 and F4): the scope twin of batch.rs.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

use serde_json::{Value, json};
use tokio::runtime::Handle;
use turso::Connection;

use crate::database::{Store, read_offset};
use crate::error::HostError;
use crate::fact_index::{FactIndex, Horizon, ensure_indexed, read_facts};
use crate::fact_log::{FactLog, StoredFact};
use crate::links::{Link, check_link, delete_link, kind_of, load_link, write_link};
use crate::manifest::{ConsumerInput, ConsumerManifest};
use crate::rows::{Row, check_row, delete_row, key_of, load_row, normalize_row, write_row};

pub trait ScopeRunner {
    /// # Errors
    /// Fails when the consumer cannot run or traps.
    fn apply_scope(&mut self, scope: &str, facts: Arc<dyn FactSource>)
    -> Result<String, HostError>;
}

pub trait FactSource: Send + Sync {
    /// The scope's facts as one JSON list.
    ///
    /// # Errors
    /// Fails when the facts cannot be read, or the scope is not the one applied.
    fn read_scope_facts(&self, scope: &str) -> Result<Vec<u8>, HostError>;
}

/// Serves the one scope's facts from the index, inside the horizon.
struct IndexFacts {
    connection: Connection,
    handle: Handle,
    scope: String,
    horizon: Horizon,
}

impl FactSource for IndexFacts {
    fn read_scope_facts(&self, scope: &str) -> Result<Vec<u8>, HostError> {
        if scope != self.scope {
            return Err(HostError::ForeignScopeRead {
                scope: self.scope.clone(),
                asked: scope.to_owned(),
            });
        }

        // As `StoreRows` in batch.rs: the module calls from inside the runtime's thread.
        let bodies = tokio::task::block_in_place(|| {
            self.handle
                .block_on(read_facts(&self.connection, scope, &self.horizon))
        })?;

        // The bodies are JSON as stored, so the list is built from their text.
        Ok(format!("[{}]", bodies.join(",")).into_bytes())
    }
}

pub enum Operation {
    Upsert {
        table: String,
        row: Row,
    },
    Delete {
        table: String,
        key: Row,
    },
    Link(Link),
    Unlink {
        link_type: String,
        from: String,
        to: String,
    },
}

/// The wire of design part C: a list whose items each hold one verb.
///
/// # Errors
/// Fails on an item of another shape, or a table the consumer does not own.
pub fn parse_operations(
    manifest: &ConsumerManifest,
    output: &str,
) -> Result<Vec<Operation>, HostError> {
    let bad = |reason: &str| HostError::BadOperation(reason.to_owned());
    let Value::Array(items) = serde_json::from_str::<Value>(output)? else {
        return Err(bad("the output is not a list"));
    };

    items
        .into_iter()
        .map(|item| {
            let Value::Object(verbs) = item else {
                return Err(bad("an operation is not an object"));
            };
            let mut verbs = verbs.into_iter();
            let (Some((verb, body)), None) = (verbs.next(), verbs.next()) else {
                return Err(bad("an operation does not hold exactly one verb"));
            };

            match verb.as_str() {
                "link" => Ok(Operation::Link(
                    serde_json::from_value(body).map_err(|error| bad(&error.to_string()))?,
                )),
                "unlink" => {
                    let text = |name: &str| {
                        body.get(name)
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_owned()
                    };

                    Ok(Operation::Unlink {
                        link_type: text("type"),
                        from: text("from"),
                        to: text("to"),
                    })
                }
                "upsert" | "delete" => {
                    let Value::Object(by_table) = body else {
                        return Err(bad("an upsert holds no table"));
                    };
                    let mut tables = by_table.into_iter();
                    let (Some((table, Value::Object(row))), None) = (tables.next(), tables.next())
                    else {
                        return Err(bad("an upsert does not hold exactly one table and one row"));
                    };

                    if !manifest.tables.contains_key(&table) {
                        return Err(HostError::NotOwned { table });
                    }

                    Ok(if verb == "upsert" {
                        Operation::Upsert { table, row }
                    } else {
                        Operation::Delete { table, key: row }
                    })
                }
                other => Err(bad(&format!("unknown verb {other}"))),
            }
        })
        .collect()
}

/// One scope batch (F3): index, dirty scopes, the module for each, `replace_scope`, the offset and
/// one change log row, in one transaction.
///
/// # Errors
/// Fails, after rolling the batch back, when the consumer fails or a check or a write fails.
pub async fn apply_scope_batch(
    store: &Store,
    manifest: &ConsumerManifest,
    runner: &mut dyn ScopeRunner,
    index: &FactIndex,
    log: &impl FactLog,
    stream: &str,
    facts: &[StoredFact],
) -> Result<(), HostError> {
    let Some(last) = facts.last() else {
        return Ok(());
    };
    let ConsumerInput::Scope {
        scope_kind,
        streams,
    } = &manifest.input
    else {
        return Err(HostError::Config(format!(
            "{} is not a scope consumer",
            manifest.name
        )));
    };

    // F3 step 1, before the transaction. Step 3: the horizon.
    let mut horizon = Horizon::new();

    ensure_indexed(index, log, stream, last.offset + 1).await?;
    horizon.insert(stream.to_owned(), last.offset);

    for other in streams.iter().filter(|other| other.as_str() != stream) {
        if let Some(offset) = read_offset(store, other).await? {
            ensure_indexed(index, log, other, offset + 1).await?;
            horizon.insert(other.clone(), offset);
        }
    }

    store.connection.execute("BEGIN IMMEDIATE", ()).await?;

    let written = write_scope_batch(
        store,
        manifest,
        runner,
        index,
        scope_kind,
        &horizon,
        stream,
        facts,
        last.offset,
    )
    .await;

    store
        .connection
        .execute(
            if written.is_ok() {
                "COMMIT"
            } else {
                "ROLLBACK"
            },
            (),
        )
        .await?;

    written
}

#[allow(clippy::too_many_arguments)]
async fn write_scope_batch(
    store: &Store,
    manifest: &ConsumerManifest,
    runner: &mut dyn ScopeRunner,
    index: &FactIndex,
    scope_kind: &str,
    horizon: &Horizon,
    stream: &str,
    facts: &[StoredFact],
    last_seq_num: u64,
) -> Result<(), HostError> {
    // Step 2: each dirty scope once, in one order on every replay.
    let scopes: BTreeSet<String> = facts
        .iter()
        .filter_map(|fact| serde_json::from_str::<Value>(&fact.body).ok())
        .filter_map(|fact| {
            fact.get("entity")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .filter(|entity| kind_of(entity) == Some(scope_kind))
        .collect();
    let mut changes: Vec<Value> = Vec::new();

    for scope in &scopes {
        let source: Arc<dyn FactSource> = Arc::new(IndexFacts {
            connection: index.store.connection.clone(),
            handle: Handle::current(),
            scope: scope.clone(),
            horizon: horizon.clone(),
        });
        let output = runner.apply_scope(scope, source)?;
        let operations = parse_operations(manifest, &output)?;

        // Step 4: every check before any write of the scope.
        for operation in &operations {
            match operation {
                Operation::Link(link) => check_link(manifest, link)?,
                Operation::Delete { .. } | Operation::Unlink { .. } => {
                    return Err(HostError::BadOperation(
                        "a scope consumer returned a delete or an unlink".to_owned(),
                    ));
                }
                Operation::Upsert { .. } => {}
            }
        }

        changes.extend(replace_scope(&store.connection, manifest, scope, operations).await?);
    }

    let last = i64::try_from(last_seq_num).map_err(|_| HostError::OutOfBounds)?;

    store
        .connection
        .execute(
            "INSERT OR REPLACE INTO offsets (stream, last_seq_num) VALUES (?1, ?2)",
            vec![turso::Value::from(stream), turso::Value::from(last)],
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

fn link_json(link: &Link) -> Value {
    json!({"type": link.link_type, "from": link.from, "to": link.to, "confidence": link.confidence, "evidence": link.evidence})
}

async fn row_owner(
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

    Ok(match rows.next().await? {
        Some(row) => Some(row.get(0)?),
        None => None,
    })
}

/// F4: the scope's result against what the scope owns, as a diff for rows and for links.
async fn replace_scope(
    connection: &Connection,
    manifest: &ConsumerManifest,
    scope: &str,
    operations: Vec<Operation>,
) -> Result<Vec<Value>, HostError> {
    // a. Key the result. The design does not say what a key twice in one result is: refused here.
    let mut rows: BTreeMap<(String, String), Row> = BTreeMap::new();
    let mut links: BTreeMap<(String, String, String), Link> = BTreeMap::new();

    for operation in operations {
        match operation {
            Operation::Upsert { table, mut row } => {
                let info = manifest
                    .tables
                    .get(&table)
                    .ok_or_else(|| HostError::NotOwned {
                        table: table.clone(),
                    })?;

                check_row(&table, info, &row)?;
                normalize_row(info, &mut row);

                let key = key_of(&table, info, &row)?;

                if rows.insert((table.clone(), key.clone()), row).is_some() {
                    return Err(HostError::BadOperation(format!(
                        "{table} {key} twice in one scope result"
                    )));
                }
            }
            Operation::Link(link) => {
                let key = (link.link_type.clone(), link.from.clone(), link.to.clone());

                if links.insert(key, link).is_some() {
                    return Err(HostError::BadOperation(
                        "a link twice in one scope result".to_owned(),
                    ));
                }
            }
            Operation::Delete { .. } | Operation::Unlink { .. } => {
                return Err(HostError::BadOperation(
                    "a scope consumer returned a delete or an unlink".to_owned(),
                ));
            }
        }
    }

    // b. Nothing of the result may belong to another scope. Checked for all before any write.
    for (table, key) in rows.keys() {
        if let Some(owner) = row_owner(connection, table, key).await?
            && owner != scope
        {
            return Err(HostError::ScopeConflict {
                scope: scope.to_owned(),
                table: table.clone(),
                key: key.clone(),
                owner,
            });
        }
    }

    let mut stored_links = BTreeMap::new();

    for (key, link) in &links {
        if let Some((owner, stored)) = load_link(connection, &key.0, &key.1, &key.2).await? {
            if owner.as_deref() != Some(scope) {
                return Err(HostError::ScopeConflict {
                    scope: scope.to_owned(),
                    table: "link".to_owned(),
                    key: link_json(link).to_string(),
                    owner: owner.unwrap_or_else(|| "(no scope)".to_owned()),
                });
            }

            stored_links.insert(key.clone(), stored);
        }
    }

    let mut changes = Vec::new();

    // c. Write what is new or differs.
    for ((table, key), row) in &rows {
        let info = &manifest.tables[table];
        let old = load_row(connection, table, info, key).await?;

        if old.as_ref() == Some(row) {
            continue;
        }

        write_row(connection, table, info, row).await?;
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

        let mut message = json!({"type": table, "key": key, "value": row,
            "headers": {"operation": if old.is_some() { "update" } else { "insert" }}});

        if let (Some(old), Some(object)) = (old, message.as_object_mut()) {
            object.insert("old_value".to_owned(), Value::Object(old));
        }

        changes.push(message);
    }

    for (key, link) in &links {
        let old = stored_links.get(key);

        if old == Some(link) {
            continue;
        }

        write_link(connection, &manifest.name, Some(scope), link).await?;

        let mut message = json!({"type": "link", "key": [key.0, key.1, key.2], "value": link_json(link),
            "headers": {"operation": if old.is_some() { "update" } else { "insert" }}});

        if let (Some(old), Some(object)) = (old, message.as_object_mut()) {
            object.insert("old_value".to_owned(), link_json(old));
        }

        changes.push(message);
    }

    // d. Delete what the scope owned and did not return.
    let mut owned = connection
        .query(
            "SELECT table_name, key FROM scope_row WHERE scope = ?1 ORDER BY table_name, key",
            vec![turso::Value::from(scope)],
        )
        .await?;
    let mut gone_rows: Vec<(String, String)> = Vec::new();

    while let Some(row) = owned.next().await? {
        let entry: (String, String) = (row.get(0)?, row.get(1)?);

        if !rows.contains_key(&entry) {
            gone_rows.push(entry);
        }
    }

    for (table, key) in gone_rows {
        let info = manifest
            .tables
            .get(&table)
            .ok_or_else(|| HostError::NotOwned {
                table: table.clone(),
            })?;
        let old = load_row(connection, &table, info, &key).await?;

        delete_row(connection, &table, info, &key).await?;
        connection
            .execute(
                "DELETE FROM scope_row WHERE table_name = ?1 AND key = ?2",
                vec![
                    turso::Value::from(table.as_str()),
                    turso::Value::from(key.as_str()),
                ],
            )
            .await?;
        changes.push(json!({"type": table, "key": key, "old_value": old, "headers": {"operation": "delete"}}));
    }

    let mut owned = connection
        .query(
            "SELECT type, from_id, to_id FROM link WHERE scope = ?1 ORDER BY type, from_id, to_id",
            vec![turso::Value::from(scope)],
        )
        .await?;
    let mut gone_links: Vec<(String, String, String)> = Vec::new();

    while let Some(row) = owned.next().await? {
        let entry: (String, String, String) = (row.get(0)?, row.get(1)?, row.get(2)?);

        if !links.contains_key(&entry) {
            gone_links.push(entry);
        }
    }

    for key in gone_links {
        delete_link(connection, &key.0, &key.1, &key.2).await?;
        changes.push(json!({"type": "link", "key": [key.0, key.1, key.2], "headers": {"operation": "delete"}}));
    }

    Ok(changes)
}
