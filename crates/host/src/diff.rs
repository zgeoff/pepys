use std::collections::BTreeMap;

use crate::consumer::TableInfo;
use crate::error::HostError;
use crate::rows::{Row, is_same_row, key_of};

/// The keys of one table that differ between two versions.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TableDiff {
    pub added: Vec<String>,
    pub changed: Vec<String>,
    pub removed: Vec<String>,
}

impl TableDiff {
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.added.is_empty() && self.changed.is_empty() && self.removed.is_empty()
    }
}

/// Compares the rows of one table in the current version with its rows in the previewed one.
///
/// # Errors
/// Fails when a row lacks a key column.
pub fn diff_rows(
    table: &str,
    info: &TableInfo,
    current: &[Row],
    previewed: &[Row],
) -> Result<TableDiff, HostError> {
    let key_rows = |rows: &[Row]| {
        rows.iter()
            .map(|row| Ok((key_of(table, info, row)?, row.clone())))
            .collect::<Result<BTreeMap<String, Row>, HostError>>()
    };
    let before = key_rows(current)?;
    let after = key_rows(previewed)?;

    Ok(TableDiff {
        added: after
            .keys()
            .filter(|key| !before.contains_key(*key))
            .cloned()
            .collect(),
        changed: after
            .iter()
            .filter(|(key, row)| {
                before
                    .get(*key)
                    .is_some_and(|old| !is_same_row(info, old, row))
            })
            .map(|(key, _)| key.clone())
            .collect(),
        removed: before
            .keys()
            .filter(|key| !after.contains_key(*key))
            .cloned()
            .collect(),
    })
}

/// The JSON `pepys preview` prints: an object keyed by table that holds only the tables with a
/// difference, each with its added, changed and removed keys.
#[must_use]
pub fn diff_json(diffs: &[(String, TableDiff)]) -> serde_json::Value {
    let tables: serde_json::Map<String, serde_json::Value> = diffs
        .iter()
        .filter(|(_, diff)| !diff.is_empty())
        .map(|(table, diff)| {
            (
                table.clone(),
                serde_json::json!({
                    "added": diff.added,
                    "changed": diff.changed,
                    "removed": diff.removed,
                }),
            )
        })
        .collect();

    serde_json::Value::Object(tables)
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    fn info() -> TableInfo {
        serde_json::from_value(json!({
            "columns": {
                "id": {"kind": "entityID", "nullable": false},
                "title": {"kind": "text", "nullable": false},
            },
            "primaryKey": ["id"],
            "indexes": [],
        }))
        .expect("a table")
    }

    fn row(id: &str, title: &str) -> Row {
        let Value::Object(row) = json!({"id": id, "title": title}) else {
            panic!("a row is an object");
        };

        row
    }

    #[test]
    fn it_lists_the_added_changed_and_removed_keys() {
        let current = [row("a", "same"), row("b", "old"), row("c", "gone")];
        let previewed = [row("a", "same"), row("b", "new"), row("d", "fresh")];

        assert_eq!(
            diff_rows("ticket", &info(), &current, &previewed).expect("a diff"),
            TableDiff {
                added: vec![r#"["d"]"#.to_owned()],
                changed: vec![r#"["b"]"#.to_owned()],
                removed: vec![r#"["c"]"#.to_owned()],
            }
        );
    }

    #[test]
    fn it_finds_no_difference_between_equal_rows() {
        let rows = [row("a", "same")];

        assert!(
            diff_rows("ticket", &info(), &rows, &rows)
                .expect("a diff")
                .is_empty()
        );
    }

    #[test]
    fn it_prints_an_empty_object_for_an_empty_diff() {
        assert_eq!(
            diff_json(&[("ticket".to_owned(), TableDiff::default())]),
            json!({})
        );
    }

    #[test]
    fn it_prints_each_table_with_a_difference() {
        let diff = TableDiff {
            added: vec!["d".to_owned()],
            changed: vec![],
            removed: vec!["c".to_owned()],
        };

        assert_eq!(
            diff_json(&[("ticket".to_owned(), diff)]),
            json!({"ticket": {"added": ["d"], "changed": [], "removed": ["c"]}})
        );
    }
}
