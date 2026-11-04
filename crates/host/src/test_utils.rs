//! Stand-ins that the host's tests share.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{Value, json};

use crate::batch::{Fact, FactRunner};
use crate::error::HostError;
use crate::module_runner::RowSource;
use crate::stream::FactLog;

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

/// A log held in memory, whose record at index `n` has sequence number `n`.
pub struct MemoryLog {
    bodies: Vec<String>,
}

impl MemoryLog {
    pub fn new(bodies: &[&str]) -> Self {
        Self {
            bodies: bodies.iter().map(|body| (*body).to_owned()).collect(),
        }
    }

    fn records(&self, from: u64, count: usize) -> Result<Vec<Fact>, HostError> {
        let start = usize::try_from(from).map_err(|_| HostError::OutOfBounds)?;

        Ok(self
            .bodies
            .iter()
            .enumerate()
            .skip(start)
            .take(count)
            .map(|(index, body)| Fact {
                seq_num: index as u64,
                body: body.clone(),
            })
            .collect())
    }
}

impl FactLog for MemoryLog {
    fn tail(&self) -> impl Future<Output = Result<u64, HostError>> {
        std::future::ready(Ok(self.bodies.len() as u64))
    }

    fn read(&self, from: u64, count: usize) -> impl Future<Output = Result<Vec<Fact>, HostError>> {
        std::future::ready(self.records(from, count))
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn it_reads_up_to_count_records_from_a_sequence_number() {
        let log = MemoryLog::new(&["a", "b", "c", "d"]);

        let facts = log.read(1, 2).await.expect("the records");

        assert_eq!(
            facts,
            vec![
                Fact {
                    seq_num: 1,
                    body: "b".to_owned()
                },
                Fact {
                    seq_num: 2,
                    body: "c".to_owned()
                },
            ]
        );
    }

    #[tokio::test]
    async fn it_reports_the_record_count_as_the_tail() {
        let log = MemoryLog::new(&["a", "b"]);

        assert_eq!(log.tail().await.expect("a tail"), 2);
    }

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
