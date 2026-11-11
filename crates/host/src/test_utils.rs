//! Stand-ins that the host's tests share.

pub mod stub_s2;

use std::collections::{BTreeMap, HashMap};
use std::sync::Arc;

use serde_json::{Value, json};

use crate::batch::FactRunner;
use crate::consumer::{
    BuildManifest, ColumnKind, ConsumerInput, ConsumerManifest, Exports, LinkType, Read, TableInfo,
    read_build_manifest_text,
};
use crate::error::HostError;
use crate::module_runner::RowSource;
use crate::scope::{FactSource, ScopeRunner};

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

/// The stub consumer's manifest with one link type, `opened_by`, from a pull request to a user. The
/// stub has no `user` table, so every such link points at an entity with no row.
///
/// # Panics
/// When the stub has no consumer.
#[must_use]
pub fn stub_manifest_with_links() -> ConsumerManifest {
    let mut manifest = stub_manifest();

    manifest.links.push(LinkType {
        name: "opened_by".to_owned(),
        from: vec!["github:pull_request".to_owned()],
        to: vec!["github:user".to_owned()],
        hub: false,
    });

    manifest
}

#[derive(serde::Deserialize)]
struct ScopeCaseConsumer {
    name: String,
    input: ConsumerInput,
    tables: BTreeMap<String, TableInfo>,
    links: Vec<LinkType>,
}

/// The stub scope consumer of the shared scope replace case file, `ledger_account`, as a manifest
/// with the SQL of its tables as `pepys build` writes it.
///
/// # Panics
/// When the case file holds no consumer or the host refuses it.
#[must_use]
pub fn stub_scope_manifest() -> ConsumerManifest {
    let cases: Value = serde_json::from_str(include_str!(
        "../../../packages/testing/src/scope-replace/scope-replace-cases.json"
    ))
    .unwrap_or_else(|error| panic!("the case file: {error}"));
    let consumer: ScopeCaseConsumer = serde_json::from_value(cases["consumer"].clone())
        .unwrap_or_else(|error| panic!("the case consumer: {error}"));
    let manifest = ConsumerManifest {
        name: consumer.name,
        input: consumer.input,
        exports: Exports {
            init: "ledger_account_init".to_owned(),
            apply: "ledger_account_apply_scope".to_owned(),
        },
        imports: vec![Read::ScopeFacts {
            length: "readScopeFactsLength".to_owned(),
            into: "readScopeFactsInto".to_owned(),
        }],
        schema: consumer
            .tables
            .iter()
            .map(|(name, info)| build_table_sql(name, info))
            .collect(),
        tables: consumer.tables,
        links: consumer.links,
    };
    let file = json!({
        "kit": 1, "deployment": null,
        "consumers": [{
            "name": manifest.name, "module": "0".repeat(64), "path": "ledger.wasm",
            "pins": {}, "version": "0".repeat(64), "manifest": manifest,
        }],
    });

    read_build_manifest_text(&file.to_string())
        .unwrap_or_else(|error| panic!("the host refuses the stub scope manifest: {error}"));

    manifest
}

fn build_table_sql(name: &str, info: &TableInfo) -> String {
    let columns: Vec<String> = info
        .columns
        .iter()
        .map(|(column, kind)| {
            let declared = match kind.kind {
                ColumnKind::Integer | ColumnKind::Boolean => "INTEGER",
                ColumnKind::Real => "REAL",
                ColumnKind::Text
                | ColumnKind::EntityId
                | ColumnKind::Timestamp
                | ColumnKind::Json => "TEXT",
            };
            let null = if kind.nullable { "" } else { " NOT NULL" };

            format!("\"{column}\" {declared}{null}")
        })
        .collect();

    format!(
        "CREATE TABLE \"{name}\" ({}, PRIMARY KEY ({}));\n",
        columns.join(", "),
        info.primary_key.join(", ")
    )
}

/// The wire form of one `link` operation of the type `link_type`.
pub fn link_json(link_type: &str, from: &str, to: &str, confidence: f64) -> Value {
    json!({"link": {
        "type": link_type, "from": from, "to": to,
        "confidence": confidence, "evidence": "event:github:delivery-1"
    }})
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

/// A scope runner that returns the operations JSON the test lists for a scope, or fails the scope.
/// It first reads the facts of the scope it is called for, or of the scope that `reads` names,
/// and keeps each read's text. A scope the test does not list returns no operations.
pub struct ScopeCannedRunner {
    outputs: HashMap<String, Result<String, String>>,
    reads: HashMap<String, String>,
    pub read: Vec<String>,
}

impl ScopeCannedRunner {
    pub fn new(outputs: &[(&str, Result<String, String>)]) -> Self {
        Self {
            outputs: outputs
                .iter()
                .map(|(scope, output)| ((*scope).to_owned(), output.clone()))
                .collect(),
            reads: HashMap::new(),
            read: Vec::new(),
        }
    }

    /// Makes the call for `scope` read the facts of `asked` instead.
    #[must_use]
    pub fn reading(mut self, scope: &str, asked: &str) -> Self {
        self.reads.insert(scope.to_owned(), asked.to_owned());
        self
    }
}

impl ScopeRunner for ScopeCannedRunner {
    fn apply_scope(
        &mut self,
        scope: &str,
        facts: Arc<dyn FactSource>,
    ) -> Result<String, HostError> {
        let asked = self.reads.get(scope).map_or(scope, String::as_str);
        let bytes = facts.read_scope_facts(asked)?;

        self.read
            .push(String::from_utf8(bytes).map_err(|_| HostError::OutOfBounds)?);

        match self.outputs.get(scope) {
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
