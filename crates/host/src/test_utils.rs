//! Stand-ins that the host's tests share.

pub mod stub_s2;

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{Value, json};

use crate::batch::FactRunner;
use crate::error::HostError;
use crate::module_runner::RowSource;

/// A pull request row as JSON, which differs from another only by its ID and title.
pub fn row_json(id: &str, title: &str) -> Value {
    json!({
        "id": id, "number": 3, "repository_id": "github:repo:9", "title": title,
        "state": "open", "is_draft": false, "is_merged": false, "author_id": null,
        "url": "https://github.example/acme/harbour/pull/3", "merge_commit_sha": null,
        "created_at": "2026-10-01T09:00:00Z", "updated_at": "2026-10-01T09:00:00Z",
        "closed_at": null, "merged_at": null, "payload": {"k": 1}
    })
}

/// The operations JSON of one upsert of [`row_json`].
pub fn upsert_json(id: &str, title: &str) -> String {
    json!([{"upsert": {"github_pull_request": row_json(id, title)}}]).to_string()
}

/// Returns the operations JSON the test lists for a fact body, or fails the fact. A body the test
/// does not list returns no operations.
pub struct CannedRunner {
    outputs: HashMap<String, Result<String, String>>,
}

impl CannedRunner {
    pub fn new(outputs: &[(&str, Result<String, String>)]) -> Self {
        Self {
            outputs: outputs
                .iter()
                .map(|(fact, output)| ((*fact).to_owned(), output.clone()))
                .collect(),
        }
    }
}

impl FactRunner for CannedRunner {
    fn apply_fact(&mut self, fact: &str, _rows: Arc<dyn RowSource>) -> Result<String, HostError> {
        match self.outputs.get(fact) {
            Some(Ok(output)) => Ok(output.clone()),
            Some(Err(message)) => Err(HostError::Panicked(message.clone())),
            None => Ok("[]".to_owned()),
        }
    }
}

/// The names of the JSON files in the fixtures folder of `port` in `packages/ingest`, sorted.
///
/// # Panics
/// When the folder cannot be read.
#[must_use]
pub fn read_fixture_files(port: &str) -> Vec<String> {
    let folder = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/ingest/src")
        .join(port)
        .join("fixtures");
    let mut names: Vec<String> = std::fs::read_dir(&folder)
        .unwrap_or_else(|_| panic!("{} is readable", folder.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| {
            std::path::Path::new(name)
                .extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect();

    names.sort();

    names
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn it_returns_the_listed_output_for_a_fact_and_none_for_another() {
        struct NoRows;

        impl RowSource for NoRows {
            fn read_row(&self, _key: &str) -> Result<Option<Vec<u8>>, HostError> {
                Ok(None)
            }
        }

        let mut runner = CannedRunner::new(&[("listed", Ok("[1]".to_owned()))]);
        let rows: Arc<dyn RowSource> = Arc::new(NoRows);

        assert_eq!(
            (
                runner
                    .apply_fact("listed", Arc::clone(&rows))
                    .expect("an output"),
                runner.apply_fact("other", rows).expect("an output"),
            ),
            ("[1]".to_owned(), "[]".to_owned())
        );
    }
}
