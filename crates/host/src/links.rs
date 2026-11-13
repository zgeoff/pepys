//! A link between two entities: the wire's flat form, the check against the manifest, and the
//! consumer file's `link` table.

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use thiserror::Error;
use turso::Connection;

use crate::consumer::LinkType;
use crate::entity_ids::kind_of;
use crate::error::HostError;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Link {
    #[serde(rename = "type")]
    pub link_type: String,
    pub from: String,
    pub to: String,
    pub confidence: f64,
    pub evidence: String,
}

/// The ends of a link to remove.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkEnds {
    #[serde(rename = "type")]
    pub link_type: String,
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkEnd {
    From,
    To,
}

impl fmt::Display for LinkEnd {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::From => "from",
            Self::To => "to",
        })
    }
}

/// What is wrong with one link, as the kit's `findLinkProblem` reports it.
#[derive(Debug, Clone, PartialEq, Error)]
pub enum LinkProblem {
    #[error("its type {link_type} is not one the consumer declares")]
    NotDeclared { link_type: String },
    #[error("the {end} end {id} is not an entity ID")]
    NotAnEntityId { end: LinkEnd, id: String },
    #[error("the {end} end {id} is of a kind that {link_type} does not allow; it allows {}", allowed.join(", "))]
    WrongKind {
        link_type: String,
        end: LinkEnd,
        id: String,
        allowed: Vec<String>,
    },
    #[error("the confidence {confidence} is outside 0 to 1")]
    BadConfidence { confidence: f64 },
    #[error("the evidence is empty")]
    NoEvidence,
}

/// The first problem of `link` against the consumer's link types, in the order the kit's check
/// keeps: the type, the `from` end, the `to` end, the confidence, the evidence. It looks no row
/// up, so a link to an entity with no row has no problem.
#[must_use]
pub fn find_link_problem(link_types: &[LinkType], link: &Link) -> Option<LinkProblem> {
    let Some(declared) = link_types
        .iter()
        .find(|declared| declared.name == link.link_type)
    else {
        return Some(LinkProblem::NotDeclared {
            link_type: link.link_type.clone(),
        });
    };

    if let Some(problem) = find_end_problem(declared, LinkEnd::From, &link.from, &declared.from)
        .or_else(|| find_end_problem(declared, LinkEnd::To, &link.to, &declared.to))
    {
        return Some(problem);
    }

    if !(0.0..=1.0).contains(&link.confidence) {
        return Some(LinkProblem::BadConfidence {
            confidence: link.confidence,
        });
    }

    link.evidence.is_empty().then_some(LinkProblem::NoEvidence)
}

fn find_end_problem(
    declared: &LinkType,
    end: LinkEnd,
    id: &str,
    allowed: &[String],
) -> Option<LinkProblem> {
    let Some(kind) = kind_of(id) else {
        return Some(LinkProblem::NotAnEntityId {
            end,
            id: id.to_owned(),
        });
    };

    (!allowed.iter().any(|allowed_kind| allowed_kind == kind)).then(|| LinkProblem::WrongKind {
        link_type: declared.name.clone(),
        end,
        id: id.to_owned(),
        allowed: allowed.to_vec(),
    })
}

/// The key of a link in a change entry: the JSON text of `[type, from, to]`.
#[must_use]
pub fn build_link_key(link_type: &str, from: &str, to: &str) -> String {
    json!([link_type, from, to]).to_string()
}

/// The change entry of a written link: an insert, or an update with the stored link.
#[must_use]
pub fn build_link_write_entry(link: &Link, old: Option<&Link>) -> Value {
    let key = build_link_key(&link.link_type, &link.from, &link.to);

    match old {
        Some(old) => json!({
            "type": "link",
            "key": key,
            "value": link,
            "old_value": old,
            "headers": {"operation": "update"},
        }),
        None => json!({
            "type": "link",
            "key": key,
            "value": link,
            "headers": {"operation": "insert"},
        }),
    }
}

impl Link {
    #[must_use]
    pub fn to_ends(&self) -> LinkEnds {
        LinkEnds {
            link_type: self.link_type.clone(),
            from: self.from.clone(),
            to: self.to.clone(),
        }
    }
}

/// The change entry of a deleted link, which holds its key alone.
#[must_use]
pub fn build_link_delete_entry(ends: &LinkEnds) -> Value {
    json!({
        "type": "link",
        "key": build_link_key(&ends.link_type, &ends.from, &ends.to),
        "headers": {"operation": "delete"},
    })
}

/// A stored link with the scope that owns it, or none for a link that fact mode wrote.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredLink {
    pub scope: Option<String>,
    pub link: Link,
}

/// The stored link with these ends.
///
/// # Errors
/// Fails when the query fails.
pub async fn load_link(
    connection: &Connection,
    ends: &LinkEnds,
) -> Result<Option<Link>, HostError> {
    Ok(load_stored_link(connection, ends)
        .await?
        .map(|stored| stored.link))
}

/// The stored link with these ends, with its scope.
///
/// # Errors
/// Fails when the query fails.
pub async fn load_stored_link(
    connection: &Connection,
    ends: &LinkEnds,
) -> Result<Option<StoredLink>, HostError> {
    let mut rows = connection
        .query(
            "SELECT confidence, evidence, scope FROM link \
             WHERE type = ?1 AND from_id = ?2 AND to_id = ?3",
            vec![
                turso::Value::from(ends.link_type.as_str()),
                turso::Value::from(ends.from.as_str()),
                turso::Value::from(ends.to.as_str()),
            ],
        )
        .await?;

    let Some(row) = rows.next().await? else {
        return Ok(None);
    };

    Ok(Some(StoredLink {
        scope: row.get(2)?,
        link: Link {
            link_type: ends.link_type.clone(),
            from: ends.from.clone(),
            to: ends.to.clone(),
            confidence: row.get(0)?,
            evidence: row.get(1)?,
        },
    }))
}

/// Every link that `scope` owns.
///
/// # Errors
/// Fails when the query fails.
pub async fn load_scope_links(
    connection: &Connection,
    scope: &str,
) -> Result<Vec<Link>, HostError> {
    let mut rows = connection
        .query(
            "SELECT type, from_id, to_id, confidence, evidence FROM link WHERE scope = ?1",
            vec![turso::Value::from(scope)],
        )
        .await?;
    let mut links = Vec::new();

    while let Some(row) = rows.next().await? {
        links.push(Link {
            link_type: row.get(0)?,
            from: row.get(1)?,
            to: row.get(2)?,
            confidence: row.get(3)?,
            evidence: row.get(4)?,
        });
    }

    Ok(links)
}

/// Writes `link` for the consumer `origin`, owned by `scope`, or by no scope in fact mode.
///
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
                turso::Value::from(link.link_type.as_str()),
                turso::Value::from(link.from.as_str()),
                turso::Value::from(link.to.as_str()),
                scope.map_or(turso::Value::Null, turso::Value::from),
                turso::Value::from(origin),
                turso::Value::from(link.confidence),
                turso::Value::from(link.evidence.as_str()),
            ],
        )
        .await?;

    Ok(())
}

/// # Errors
/// Fails when the statement fails.
pub async fn delete_link(connection: &Connection, ends: &LinkEnds) -> Result<(), HostError> {
    connection
        .execute(
            "DELETE FROM link WHERE type = ?1 AND from_id = ?2 AND to_id = ?3",
            vec![
                turso::Value::from(ends.link_type.as_str()),
                turso::Value::from(ends.from.as_str()),
                turso::Value::from(ends.to.as_str()),
            ],
        )
        .await?;

    Ok(())
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    const CASES: &str = include_str!("../../../packages/kit/src/links/link-check-cases.json");

    #[derive(Deserialize)]
    struct CaseFile {
        consumer: CaseConsumer,
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    struct CaseConsumer {
        links: Vec<LinkType>,
    }

    #[derive(Deserialize)]
    struct Case {
        title: String,
        link: Link,
        problem: Option<String>,
    }

    fn to_problem_kind(problem: &LinkProblem) -> String {
        match problem {
            LinkProblem::NotDeclared { .. } => "not-declared",
            LinkProblem::NotAnEntityId { .. } => "not-an-entity-id",
            LinkProblem::WrongKind { .. } => "wrong-kind",
            LinkProblem::BadConfidence { .. } => "bad-confidence",
            LinkProblem::NoEvidence => "no-evidence",
        }
        .to_owned()
    }

    #[test]
    fn it_gives_each_shared_link_case_its_problem() {
        let file: CaseFile = serde_json::from_str(CASES).expect("the cases");

        let wrong: Vec<(String, Option<String>)> = file
            .cases
            .iter()
            .filter_map(|case| {
                let problem = find_link_problem(&file.consumer.links, &case.link)
                    .as_ref()
                    .map(to_problem_kind);

                (problem != case.problem).then(|| (case.title.clone(), problem))
            })
            .collect();

        assert_eq!(wrong, Vec::new());
    }

    #[test]
    fn it_names_the_end_the_id_and_the_allowed_kinds_of_a_wrong_kind() {
        let declared = LinkType {
            name: "holds".to_owned(),
            from: vec!["archive:shelf".to_owned()],
            to: vec!["archive:box".to_owned(), "archive:crate".to_owned()],
            hub: false,
        };
        let link = Link {
            link_type: "holds".to_owned(),
            from: "archive:shelf:s-1".to_owned(),
            to: "archive:room:r-1".to_owned(),
            confidence: 1.0,
            evidence: "event:archive:e-1".to_owned(),
        };

        assert_eq!(
            find_link_problem(&[declared], &link).map(|problem| problem.to_string()),
            Some(
                "the to end archive:room:r-1 is of a kind that holds does not allow; it allows \
                 archive:box, archive:crate"
                    .to_owned()
            )
        );
    }
}
