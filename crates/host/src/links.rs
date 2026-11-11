//! SPIKE. Links in the host (design part D links.rs, part E the `link` table, part F5).

use serde::Deserialize;
use turso::{Connection, Value};

use crate::error::HostError;
use crate::manifest::ConsumerManifest;

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Link {
    #[serde(rename = "type")]
    pub link_type: String,
    pub from: String,
    pub to: String,
    pub confidence: f64,
    pub evidence: String,
}

/// `<source>:<kind>` of an entity ID: the text before the second colon, all three parts non-empty.
#[must_use]
pub fn kind_of(id: &str) -> Option<&str> {
    let mut parts = id.splitn(3, ':');
    let source = parts.next()?;
    let kind = parts.next()?;
    let rest = parts.next()?;

    if source.is_empty() || kind.is_empty() || rest.is_empty() {
        return None;
    }

    id.get(..source.len() + 1 + kind.len())
}

/// The type is declared, each end is of a kind the type lists, the confidence is 0 to 1 and the
/// evidence is not empty. It looks no row up.
///
/// # Errors
/// Fails with the rule the link breaks.
pub fn check_link(manifest: &ConsumerManifest, link: &Link) -> Result<(), HostError> {
    let declared = manifest
        .links
        .iter()
        .find(|declared| declared.name == link.link_type)
        .ok_or_else(|| HostError::LinkNotDeclared {
            link_type: link.link_type.clone(),
        })?;

    for (end, id, kinds) in [
        ("from", &link.from, &declared.from),
        ("to", &link.to, &declared.to),
    ] {
        if !kind_of(id).is_some_and(|kind| kinds.iter().any(|listed| listed == kind)) {
            return Err(HostError::LinkKinds {
                link_type: link.link_type.clone(),
                end,
                id: id.clone(),
            });
        }
    }

    if !(0.0..=1.0).contains(&link.confidence) {
        return Err(HostError::LinkValue {
            link_type: link.link_type.clone(),
            reason: "the confidence is outside 0 to 1",
        });
    }

    if link.evidence.is_empty() {
        return Err(HostError::LinkValue {
            link_type: link.link_type.clone(),
            reason: "the evidence is empty",
        });
    }

    Ok(())
}

/// The stored link with this key, and the scope that owns it.
///
/// # Errors
/// Fails when the query fails.
pub async fn load_link(
    connection: &Connection,
    link_type: &str,
    from: &str,
    to: &str,
) -> Result<Option<(Option<String>, Link)>, HostError> {
    let mut rows = connection
        .query(
            "SELECT scope, confidence, evidence FROM link \
             WHERE type = ?1 AND from_id = ?2 AND to_id = ?3",
            vec![Value::from(link_type), Value::from(from), Value::from(to)],
        )
        .await?;

    let Some(row) = rows.next().await? else {
        return Ok(None);
    };

    Ok(Some((
        row.get(0)?,
        Link {
            link_type: link_type.to_owned(),
            from: from.to_owned(),
            to: to.to_owned(),
            confidence: row.get(1)?,
            evidence: row.get(2)?,
        },
    )))
}

/// # Errors
/// Fails when the statement fails.
pub async fn write_link(
    connection: &Connection,
    origin: &str,
    scope: Option<&str>,
    link: &Link,
) -> Result<(), HostError> {
    connection
        .execute(
            "INSERT OR REPLACE INTO link (type, from_id, to_id, scope, origin, confidence, evidence) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            vec![
                Value::from(link.link_type.as_str()),
                Value::from(link.from.as_str()),
                Value::from(link.to.as_str()),
                scope.map_or(Value::Null, Value::from),
                Value::from(origin),
                Value::from(link.confidence),
                Value::from(link.evidence.as_str()),
            ],
        )
        .await?;

    Ok(())
}

/// # Errors
/// Fails when the statement fails.
pub async fn delete_link(
    connection: &Connection,
    link_type: &str,
    from: &str,
    to: &str,
) -> Result<(), HostError> {
    connection
        .execute(
            "DELETE FROM link WHERE type = ?1 AND from_id = ?2 AND to_id = ?3",
            vec![Value::from(link_type), Value::from(from), Value::from(to)],
        )
        .await?;

    Ok(())
}
