//! Stand-ins that the host's tests share.

pub mod stub_s2;

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{Value, json};

use crate::batch::FactRunner;
use crate::consumer::{BuildManifest, ConsumerManifest, read_build_manifest_text};
use crate::error::HostError;
use crate::module_runner::RowSource;

/// The case "accepts the stub deployment" of the shared manifest case file: the `consumers.json`
/// that `pepys build` writes for the repo's stub deployment, with one fact consumer of the GitHub
/// pull request table.
///
/// # Panics
/// When the case file has no such case or the host refuses it.
#[must_use]
pub fn stub_build_manifest() -> BuildManifest {
    let cases: Value = serde_json::from_str(include_str!(
        "../../../packages/schema/src/consumer-manifest/consumer-manifest-cases.json"
    ))
    .unwrap_or_else(|error| panic!("the case file: {error}"));
    let file = cases["cases"]
        .as_array()
        .and_then(|cases| {
            cases
                .iter()
                .find(|case| case["title"] == "accepts the stub deployment")
        })
        .map_or_else(
            || panic!("the case file holds the stub deployment"),
            |case| case["file"].to_string(),
        );

    read_build_manifest_text(&file).unwrap_or_else(|error| panic!("the stub: {error}"))
}

/// A module in the WebAssembly text form, which wasmtime compiles as it compiles a binary one. It
/// exports `init` and `apply` as a scriptc module does, and `apply` returns `output` for any fact.
#[must_use]
pub fn build_text_module(init: &str, apply: &str, output: &str) -> Vec<u8> {
    let data = output.replace('\\', "\\\\").replace('"', "\\\"");
    let length = output.len();

    format!(
        r#"(module
  (memory (export "memory") 1)
  (global $next (mut i32) (i32.const 32768))
  (data (i32.const 16) "{data}")
  (func (export "_initialize"))
  (func (export "{init}"))
  (func (export "scriptc_alloc") (param $size i32) (result i32)
    (local $at i32)
    (local.set $at (global.get $next))
    (global.set $next (i32.add (global.get $next) (i32.add (local.get $size) (i32.const 8))))
    (local.get $at))
  (func (export "{apply}") (param i32 i32 i32 i32)
    (i32.store (local.get 2) (i32.const 16))
    (i32.store (local.get 3) (i32.const {length}))))"#
    )
    .into_bytes()
}

/// The manifest of the stub deployment's one consumer.
///
/// # Panics
/// When the stub has no consumer.
#[must_use]
pub fn stub_manifest() -> ConsumerManifest {
    stub_build_manifest()
        .consumers
        .into_iter()
        .next()
        .map_or_else(
            || panic!("the stub lists a consumer"),
            |consumer| consumer.manifest,
        )
}

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
            fn read_row(&self, _table: &str, _key: &str) -> Result<Option<Vec<u8>>, HostError> {
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
