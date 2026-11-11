//! SPIKE. The fact index (design parts D and E): one row per fact ID, read by entity in time order.

use std::collections::BTreeMap;
use std::path::Path;

use serde_json::Value;

use crate::database::{Store, open_store};
use crate::error::HostError;
use crate::fact_log::FactLog;

/// How far a scope may read on each of the consumer's streams: the last sequence number.
pub type Horizon = BTreeMap<String, u64>;

pub struct FactIndex {
    pub store: Store,
}

const TABLES: &str = "
CREATE TABLE IF NOT EXISTS fact (fact_id TEXT NOT NULL PRIMARY KEY, entity TEXT NOT NULL, at TEXT NOT NULL,
  at_sort TEXT NOT NULL, stream TEXT NOT NULL, seq_num INTEGER NOT NULL, type TEXT NOT NULL, body TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS fact_entity_idx ON fact (entity, at_sort, stream, seq_num);
CREATE TABLE IF NOT EXISTS offsets (stream TEXT NOT NULL PRIMARY KEY, last_seq_num INTEGER NOT NULL);
";

/// # Errors
/// Fails when the file cannot be opened or a statement fails.
pub async fn open_index(path: &Path) -> Result<FactIndex, HostError> {
    let store = open_store(path).await?;

    store.connection.execute_batch(TABLES).await?;

    Ok(FactIndex { store })
}

/// `at` with its fraction set to 9 digits, so text order is time order.
#[must_use]
pub fn sort_key_of(at: &str) -> String {
    let body = at.trim_end_matches('Z');
    let (seconds, fraction) = body.split_once('.').unwrap_or((body, ""));

    format!("{seconds}.{fraction:0<9}Z")
}

/// Indexes the records of `stream` below `stop` that the index does not hold yet.
///
/// # Errors
/// Fails when the log or the index fails.
pub async fn ensure_indexed(
    index: &FactIndex,
    log: &impl FactLog,
    stream: &str,
    stop: u64,
) -> Result<(), HostError> {
    let connection = &index.store.connection;
    let mut next = crate::database::read_offset(&index.store, stream)
        .await?
        .map_or(0, |last| last + 1);

    while next < stop {
        let count = usize::try_from(stop - next).map_err(|_| HostError::OutOfBounds)?;
        let records = log.read(stream, next, count.min(100)).await?;

        if records.is_empty() {
            break;
        }

        connection.execute("BEGIN IMMEDIATE", ()).await?;

        for record in &records {
            let fact: Value = serde_json::from_str(&record.body)?;
            let text = |name: &str| fact.get(name).and_then(Value::as_str).unwrap_or_default();
            let at = text("at");

            connection
                .execute(
                    "INSERT OR IGNORE INTO fact (fact_id, entity, at, at_sort, stream, seq_num, type, body) \
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    vec![
                        turso::Value::from(text("id")),
                        turso::Value::from(text("entity")),
                        turso::Value::from(at),
                        turso::Value::from(sort_key_of(at)),
                        turso::Value::from(stream),
                        turso::Value::from(i64::try_from(record.offset).map_err(|_| HostError::OutOfBounds)?),
                        turso::Value::from(text("type")),
                        turso::Value::from(record.body.as_str()),
                    ],
                )
                .await?;
            next = record.offset + 1;
        }

        connection
            .execute(
                "INSERT OR REPLACE INTO offsets (stream, last_seq_num) VALUES (?1, ?2)",
                vec![
                    turso::Value::from(stream),
                    turso::Value::from(
                        i64::try_from(next - 1).map_err(|_| HostError::OutOfBounds)?,
                    ),
                ],
            )
            .await?;
        connection.execute("COMMIT", ()).await?;
    }

    Ok(())
}

/// The bodies of the entity's facts inside the horizon, in time order.
///
/// # Errors
/// Fails when the query fails.
pub async fn read_entity_facts(
    index: &FactIndex,
    entity: &str,
    horizon: &Horizon,
) -> Result<Vec<String>, HostError> {
    read_facts(&index.store.connection, entity, horizon).await
}

/// [`read_entity_facts`] on a connection, for the read a module makes inside a batch.
///
/// # Errors
/// Fails when the query fails.
pub async fn read_facts(
    connection: &turso::Connection,
    entity: &str,
    horizon: &Horizon,
) -> Result<Vec<String>, HostError> {
    let mut bodies = Vec::new();

    if horizon.is_empty() {
        return Ok(bodies);
    }

    let mut values = vec![turso::Value::from(entity)];
    let mut filters = Vec::new();

    for (stream, last) in horizon {
        filters.push(format!(
            "(stream = ?{} AND seq_num <= ?{})",
            values.len() + 1,
            values.len() + 2
        ));
        values.push(turso::Value::from(stream.as_str()));
        values.push(turso::Value::from(
            i64::try_from(*last).map_err(|_| HostError::OutOfBounds)?,
        ));
    }

    let mut rows = connection
        .query(
            &format!(
                "SELECT body FROM fact WHERE entity = ?1 AND ({}) ORDER BY at_sort, stream, seq_num",
                filters.join(" OR ")
            ),
            values,
        )
        .await?;

    while let Some(row) = rows.next().await? {
        bodies.push(row.get(0)?);
    }

    Ok(bodies)
}
