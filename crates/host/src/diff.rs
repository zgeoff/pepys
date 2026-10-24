use std::collections::BTreeMap;

use pepys_schema::GithubPullRequestRow;

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

/// Compares the rows of the current version with the rows of the previewed one.
#[must_use]
pub fn diff_rows(
    current: &[GithubPullRequestRow],
    previewed: &[GithubPullRequestRow],
) -> TableDiff {
    let before: BTreeMap<&str, &GithubPullRequestRow> =
        current.iter().map(|row| (row.id.as_str(), row)).collect();
    let after: BTreeMap<&str, &GithubPullRequestRow> =
        previewed.iter().map(|row| (row.id.as_str(), row)).collect();

    TableDiff {
        added: after
            .keys()
            .filter(|key| !before.contains_key(*key))
            .map(|key| (*key).to_owned())
            .collect(),
        changed: after
            .iter()
            .filter(|(key, row)| before.get(*key).is_some_and(|old| old != *row))
            .map(|(key, _)| (*key).to_owned())
            .collect(),
        removed: before
            .keys()
            .filter(|key| !after.contains_key(*key))
            .map(|key| (*key).to_owned())
            .collect(),
    }
}

/// The JSON `pepys preview` prints: an object keyed by table that holds only the tables with a
/// difference, each with its added, changed and removed keys.
#[must_use]
pub fn diff_json(diffs: &[(&str, TableDiff)]) -> serde_json::Value {
    let tables: serde_json::Map<String, serde_json::Value> = diffs
        .iter()
        .filter(|(_, diff)| !diff.is_empty())
        .map(|(table, diff)| {
            (
                (*table).to_owned(),
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
mod tests {
    use super::*;

    fn row(id: &str, title: &str) -> GithubPullRequestRow {
        GithubPullRequestRow {
            id: id.to_owned(),
            number: 1,
            repository_id: "github:repo:1".to_owned(),
            title: title.to_owned(),
            state: "open".to_owned(),
            is_draft: false,
            is_merged: false,
            author_id: None,
            url: "https://github.example/acme/harbour/pull/1".to_owned(),
            merge_commit_sha: None,
            created_at: "2026-10-01T09:00:00Z".to_owned(),
            updated_at: "2026-10-01T09:00:00Z".to_owned(),
            closed_at: None,
            merged_at: None,
            payload: serde_json::Value::Null,
        }
    }

    #[test]
    fn it_lists_the_added_changed_and_removed_keys() {
        let current = [row("a", "same"), row("b", "old"), row("c", "gone")];
        let previewed = [row("a", "same"), row("b", "new"), row("d", "fresh")];

        assert_eq!(
            diff_rows(&current, &previewed),
            TableDiff {
                added: vec!["d".to_owned()],
                changed: vec!["b".to_owned()],
                removed: vec!["c".to_owned()],
            }
        );
    }

    #[test]
    fn it_finds_no_difference_between_equal_rows() {
        let rows = [row("a", "same")];

        assert!(diff_rows(&rows, &rows).is_empty());
    }

    #[test]
    fn it_prints_an_empty_object_for_an_empty_diff() {
        assert_eq!(
            diff_json(&[("github_pull_request", TableDiff::default())]),
            serde_json::json!({})
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
            diff_json(&[("github_pull_request", diff)]),
            serde_json::json!({
                "github_pull_request": {"added": ["d"], "changed": [], "removed": ["c"]}
            })
        );
    }
}
