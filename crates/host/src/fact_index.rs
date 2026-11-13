//! The fact index of a scope consumer: the facts of its own streams in its own file, one row per
//! fact ID, read by entity in time order. The index of a batch's facts commits with the batch.

use serde::Deserialize;
use turso::Connection;

use crate::error::HostError;
use crate::fact_log::StoredFact;

// The fields of an envelope that the index keeps apart from the body. The envelope check on
// append guarantees them.
#[derive(Deserialize)]
struct IndexedFields {
    id: String,
    entity: String,
    at: String,
}

/// Adds each record of `stream` to the index, inside the caller's transaction. A copy of a fact
/// adds nothing: the first copy in sequence order stays.
///
/// # Errors
/// Fails when a body is no envelope or a statement fails.
pub async fn index_facts(
    connection: &Connection,
    stream: &str,
    facts: &[StoredFact],
) -> Result<(), HostError> {
    for fact in facts {
        let fields: IndexedFields = serde_json::from_str(&fact.body)?;
        let seq_num = i64::try_from(fact.offset).map_err(|_| HostError::OutOfBounds)?;

        connection
            .execute(
                "INSERT OR IGNORE INTO scope_fact (fact_id, entity, at_sort, stream, seq_num, body) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                vec![
                    turso::Value::from(fields.id),
                    turso::Value::from(fields.entity),
                    turso::Value::from(sort_key_of(&fields.at)),
                    turso::Value::from(stream),
                    turso::Value::from(seq_num),
                    turso::Value::from(fact.body.as_str()),
                ],
            )
            .await?;
    }

    Ok(())
}

/// Every indexed fact of `entity` as one JSON list of the stored bodies, sorted by time, then
/// stream, then sequence number.
///
/// # Errors
/// Fails when the query fails.
pub async fn read_entity_facts(connection: &Connection, entity: &str) -> Result<String, HostError> {
    let mut rows = connection
        .query(
            "SELECT body FROM scope_fact WHERE entity = ?1 ORDER BY at_sort, stream, seq_num",
            vec![turso::Value::from(entity)],
        )
        .await?;
    let mut bodies: Vec<String> = Vec::new();

    while let Some(row) = rows.next().await? {
        bodies.push(row.get(0)?);
    }

    Ok(format!("[{}]", bodies.join(",")))
}

/// `at` with the fraction of its seconds set to 9 digits, so that text order is time order. Text
/// with no `T<hh>:<mm>:<ss>` before its first `.` stays as it is. The test store's sort key is the
/// same rule.
#[must_use]
pub fn sort_key_of(at: &str) -> String {
    let limit = at.find('.').unwrap_or(at.len());
    let Some(end) = (0..limit)
        .rev()
        .filter(|start| start + 9 <= limit && is_time_at(&at.as_bytes()[*start..*start + 9]))
        .map(|start| start + 9)
        .next()
    else {
        return at.to_owned();
    };
    let rest = &at[end..];
    let digits = rest.strip_prefix('.').map_or(0, |after| {
        after.bytes().take_while(u8::is_ascii_digit).count()
    });
    let (fraction, zone) = if digits > 0 {
        (&rest[1..=digits], &rest[1 + digits..])
    } else {
        ("", rest)
    };
    let fraction: String = fraction
        .chars()
        .chain(std::iter::repeat('0'))
        .take(9)
        .collect();

    format!("{}.{fraction}{zone}", &at[..end])
}

fn is_time_at(bytes: &[u8]) -> bool {
    matches!(
        bytes,
        [b'T', h1, h2, b':', m1, m2, b':', s1, s2]
            if [h1, h2, m1, m2, s1, s2].iter().all(|byte| byte.is_ascii_digit())
    )
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;
    use crate::database::{open_store, prepare_scope_tables, prepare_store};

    #[test]
    fn it_pads_the_fraction_of_the_seconds_to_nine_digits() {
        assert_eq!(
            sort_key_of("2026-11-01T09:00:00.5Z"),
            "2026-11-01T09:00:00.500000000Z"
        );
    }

    #[test]
    fn it_gives_a_time_with_no_fraction_a_fraction_of_zeros() {
        assert_eq!(
            sort_key_of("2026-11-01T09:00:00+02:00"),
            "2026-11-01T09:00:00.000000000+02:00"
        );
    }

    #[test]
    fn it_cuts_a_fraction_longer_than_nine_digits() {
        assert_eq!(
            sort_key_of("2026-11-01T09:00:00.1234567891Z"),
            "2026-11-01T09:00:00.123456789Z"
        );
    }

    #[test]
    fn it_orders_two_fraction_lengths_by_time() {
        assert!(sort_key_of("2026-11-01T09:00:00.5Z") > sort_key_of("2026-11-01T09:00:00.25Z"));
    }

    #[test]
    fn it_keeps_text_with_no_time_as_it_is() {
        assert_eq!(sort_key_of("yesterday"), "yesterday");
    }

    fn fact(offset: u64, id: &str, entity: &str, at: &str) -> StoredFact {
        StoredFact {
            offset,
            body: format!(r#"{{"id":"{id}","entity":"{entity}","at":"{at}"}}"#),
            appended_at_ms: 0,
        }
    }

    #[tokio::test]
    async fn it_reads_an_entitys_facts_in_time_order_with_one_row_per_fact_id() {
        let directory = tempfile::tempdir().expect("a directory");
        let store = open_store(&directory.path().join("consumer.db"))
            .await
            .expect("a store");

        prepare_store(&store, "").await.expect("the host's tables");
        prepare_scope_tables(&store)
            .await
            .expect("the scope tables");

        let late = fact(
            0,
            "event:ledger:2",
            "ledger:account:a",
            "2026-11-01T10:00:00Z",
        );
        let early = fact(
            1,
            "event:ledger:1",
            "ledger:account:a",
            "2026-11-01T09:00:00.5Z",
        );
        let other = fact(
            2,
            "event:ledger:3",
            "ledger:account:b",
            "2026-11-01T08:00:00Z",
        );
        let copy = fact(
            3,
            "event:ledger:2",
            "ledger:account:a",
            "2026-11-01T10:00:00Z",
        );

        index_facts(
            &store.connection,
            "facts.ledger.account",
            &[late.clone(), early.clone(), other, copy],
        )
        .await
        .expect("an index");

        assert_eq!(
            read_entity_facts(&store.connection, "ledger:account:a")
                .await
                .expect("the facts"),
            format!("[{},{}]", early.body, late.body)
        );
    }
}
