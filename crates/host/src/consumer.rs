//! `consumers.json` and a version's `version.json`: the serde types of a consumer manifest and the
//! one checked load path. The host reads nothing else about a consumer.

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::durable::write_durably;
use crate::error::HostError;

/// The tables the host keeps in every consumer file, which no consumer may declare.
pub const RESERVED_TABLES: [&str; 7] = [
    "link",
    "entity",
    "offsets",
    "change_log",
    "applied_facts",
    "scope_row",
    "scope_fact",
];

const VERSION_FILE: &str = "version.json";

/// `consumers.json`, as `pepys build` writes it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BuildManifest {
    pub kit: u32,
    // serde reads a missing `Option` field as `None`; a custom reader makes the field required.
    #[serde(deserialize_with = "Option::deserialize")]
    pub deployment: Option<String>,
    pub consumers: Vec<ListedConsumer>,
}

/// One entry of `consumers.json`: a version with the path of its module file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ListedConsumer {
    pub name: String,
    pub module: String,
    /// The module file, relative to the folder of `consumers.json`.
    pub path: String,
    pub pins: BTreeMap<String, String>,
    pub version: String,
    pub manifest: ConsumerManifest,
}

impl ListedConsumer {
    /// The entry as the version that `up` stores in its `version.json`.
    #[must_use]
    pub fn to_version(&self) -> ConsumerVersion {
        ConsumerVersion {
            name: self.name.clone(),
            module: self.module.clone(),
            pins: self.pins.clone(),
            version: self.version.clone(),
            manifest: self.manifest.clone(),
        }
    }
}

/// One version of a consumer, as a version folder's `version.json` holds it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConsumerVersion {
    pub name: String,
    /// The SHA-256 of the module's bytes.
    pub module: String,
    pub pins: BTreeMap<String, String>,
    /// The name of the version's folder. The build computes it; the host never does.
    pub version: String,
    pub manifest: ConsumerManifest,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ConsumerManifest {
    pub name: String,
    pub input: ConsumerInput,
    pub exports: Exports,
    pub imports: Vec<Read>,
    pub tables: BTreeMap<String, TableInfo>,
    pub links: Vec<LinkType>,
    /// The SQL of the consumer's tables, indexes and `entity` view.
    pub schema: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ConsumerInput {
    Fact {
        streams: Vec<String>,
    },
    Scope {
        scope_kind: String,
        streams: Vec<String>,
    },
}

impl ConsumerInput {
    #[must_use]
    pub fn streams(&self) -> &[String] {
        match self {
            Self::Fact { streams } | Self::Scope { streams, .. } => streams,
        }
    }
}

/// The two symbols the host calls.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Exports {
    pub init: String,
    pub apply: String,
}

/// A read the host serves the module, through two imports: `length(argument) -> f64` and
/// `into(argument, buffer)`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Read {
    /// One row of one of the consumer's own tables.
    Row {
        table: String,
        length: String,
        into: String,
    },
    /// Every fact of the scope's entity.
    ScopeFacts { length: String, into: String },
}

impl Read {
    fn symbols(&self) -> [&str; 2] {
        match self {
            Self::Row { length, into, .. } | Self::ScopeFacts { length, into } => {
                [length.as_str(), into.as_str()]
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TableInfo {
    pub columns: BTreeMap<String, ColumnInfo>,
    pub primary_key: Vec<String>,
    pub indexes: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColumnInfo {
    pub kind: ColumnKind,
    pub nullable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ColumnKind {
    Text,
    Integer,
    Real,
    Boolean,
    Json,
    #[serde(rename = "entityID")]
    EntityId,
    Timestamp,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkType {
    pub name: String,
    pub from: Vec<String>,
    pub to: Vec<String>,
    pub hub: bool,
}

/// Reads `consumers.json` strictly and checks it. The only way to get a [`BuildManifest`].
///
/// # Errors
/// Fails when the file cannot be read, holds a field this host does not know, or breaks a rule.
pub fn read_build_manifest(path: &Path) -> Result<BuildManifest, HostError> {
    read_build_manifest_text(&std::fs::read_to_string(path)?)
}

/// Parses the text of `consumers.json` strictly and checks it.
///
/// # Errors
/// Fails when the text holds a field this host does not know, or breaks a rule.
pub fn read_build_manifest_text(text: &str) -> Result<BuildManifest, HostError> {
    let file: BuildManifest = serde_json::from_str(text).map_err(|error| bad("", &error))?;

    check_build_manifest(&file)?;

    Ok(file)
}

/// Finds the entry of the consumer called `name`.
///
/// # Errors
/// Fails when the file lists no consumer of that name.
pub fn find_consumer<'a>(
    file: &'a BuildManifest,
    name: &str,
) -> Result<&'a ListedConsumer, HostError> {
    file.consumers
        .iter()
        .find(|consumer| consumer.name == name)
        .ok_or_else(|| HostError::UnknownConsumer(name.to_owned()))
}

/// Reads the `version.json` of a version folder, through the checks an entry of
/// `consumers.json` passes.
///
/// # Errors
/// Fails when the file cannot be read, holds a field this host does not know, or breaks a rule.
pub fn read_version(directory: &Path) -> Result<ConsumerVersion, HostError> {
    let path = directory.join(VERSION_FILE);
    let version: ConsumerVersion = serde_json::from_str(&std::fs::read_to_string(&path)?)
        .map_err(|error| bad(&path.display().to_string(), &error))?;

    check_consumer_version(&version)?;

    Ok(version)
}

/// Writes `version` as the `version.json` of a version folder, so that a crash leaves the whole
/// old file, the whole new file, or none.
///
/// # Errors
/// Fails when the file cannot be written.
pub fn write_version(directory: &Path, version: &ConsumerVersion) -> Result<(), HostError> {
    write_durably(
        &directory.join(VERSION_FILE),
        serde_json::to_string_pretty(version)?.as_bytes(),
    )
}

/// Whether a version folder holds a `version.json`.
#[must_use]
pub fn has_version_file(directory: &Path) -> bool {
    directory.join(VERSION_FILE).exists()
}

fn bad(path: &str, reason: &impl ToString) -> HostError {
    HostError::BadManifest {
        path: path.to_owned(),
        reason: reason.to_string(),
    }
}

fn check_build_manifest(file: &BuildManifest) -> Result<(), HostError> {
    if file.kit != 1 {
        return Err(bad("kit", &"the host reads kit 1"));
    }

    if file.deployment.as_deref() == Some("") {
        return Err(bad("deployment", &"empty"));
    }

    let mut names = BTreeSet::new();
    let mut tables = BTreeSet::new();

    for (index, listed) in file.consumers.iter().enumerate() {
        let at = format!("consumers[{index}]");

        check_module_path(&at, &listed.path)?;
        check_consumer_version(&listed.to_version()).map_err(|error| prefix_path(&at, error))?;

        if !names.insert(listed.name.as_str()) {
            return Err(bad(&at, &format!("{} is listed twice", listed.name)));
        }

        for table in listed.manifest.tables.keys() {
            if !tables.insert(table.as_str()) {
                return Err(bad(&at, &format!("the table {table} is in two consumers")));
            }
        }
    }

    Ok(())
}

fn prefix_path(at: &str, error: HostError) -> HostError {
    if let HostError::BadManifest { path, reason } = &error {
        return bad(&format!("{at}.{path}"), reason);
    }

    error
}

fn check_module_path(at: &str, path: &str) -> Result<(), HostError> {
    if path.is_empty() || path.starts_with('/') || path.split('/').any(|part| part == "..") {
        return Err(bad(
            &format!("{at}.path"),
            &"expected a path inside the folder of consumers.json",
        ));
    }

    Ok(())
}

fn check_consumer_version(version: &ConsumerVersion) -> Result<(), HostError> {
    check_hash("module", &version.module)?;
    check_hash("version", &version.version)?;

    for (name, pin) in &version.pins {
        check_name("pins", name)?;
        check_hash(&format!("pins.{name}"), pin)?;
    }

    if version.name != version.manifest.name {
        return Err(bad("name", &"differs from the name of its manifest"));
    }

    check_manifest(&version.manifest)
}

fn check_hash(at: &str, hash: &str) -> Result<(), HostError> {
    let is_hash = hash.len() == 64
        && hash
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte));

    if is_hash {
        Ok(())
    } else {
        Err(bad(at, &"expected a SHA-256 as 64 lowercase hex digits"))
    }
}

fn check_name(at: &str, name: &str) -> Result<(), HostError> {
    if name.is_empty() {
        Err(bad(at, &"an empty name"))
    } else {
        Ok(())
    }
}

// The stream and kind forms match the TypeScript schema's template literals, whose parts may be
// any text, so the two parsers give each case the same verdict.
fn is_stream(stream: &str) -> bool {
    stream
        .strip_prefix("facts.")
        .is_some_and(|rest| rest.contains('.'))
}

fn is_entity_kind(kind: &str) -> bool {
    kind.contains(':')
}

fn check_manifest(manifest: &ConsumerManifest) -> Result<(), HostError> {
    check_name("manifest.name", &manifest.name)?;
    check_input(&manifest.input)?;
    check_reads(manifest)?;
    check_symbols(manifest)?;
    check_links(&manifest.links)?;

    for (name, table) in &manifest.tables {
        check_table(name, table)?;
    }

    if manifest.schema.is_empty() {
        return Err(bad("manifest.schema", &"empty"));
    }

    Ok(())
}

fn check_input(input: &ConsumerInput) -> Result<(), HostError> {
    if let ConsumerInput::Scope { scope_kind, .. } = input
        && !is_entity_kind(scope_kind)
    {
        return Err(bad("manifest.input.scopeKind", &"expected <source>:<kind>"));
    }

    if input.streams().is_empty() {
        return Err(bad("manifest.input.streams", &"empty"));
    }

    match input.streams().iter().find(|stream| !is_stream(stream)) {
        Some(stream) => Err(bad(
            "manifest.input.streams",
            &format!("{stream} is not facts.<source>.<family>"),
        )),
        None => Ok(()),
    }
}

fn check_reads(manifest: &ConsumerManifest) -> Result<(), HostError> {
    match &manifest.input {
        ConsumerInput::Scope { .. } => match manifest.imports.as_slice() {
            [Read::ScopeFacts { .. }] => Ok(()),
            _ => Err(bad(
                "manifest.imports",
                &"a scope consumer has exactly one read, of kind scope_facts",
            )),
        },
        ConsumerInput::Fact { .. } => {
            for read in &manifest.imports {
                match read {
                    Read::ScopeFacts { .. } => {
                        return Err(bad("manifest.imports", &"a fact consumer reads rows only"));
                    }
                    Read::Row { table, .. } if !manifest.tables.contains_key(table) => {
                        return Err(bad(
                            "manifest.imports",
                            &format!(
                                "the row read names {table}, which is no table of the consumer"
                            ),
                        ));
                    }
                    Read::Row { .. } => {}
                }
            }

            Ok(())
        }
    }
}

fn check_symbols(manifest: &ConsumerManifest) -> Result<(), HostError> {
    let symbols = [
        manifest.exports.init.as_str(),
        manifest.exports.apply.as_str(),
    ]
    .into_iter()
    .chain(manifest.imports.iter().flat_map(Read::symbols));
    let mut seen = BTreeSet::new();

    for symbol in symbols {
        check_name("manifest symbols", symbol)?;

        if !seen.insert(symbol) {
            return Err(bad(
                "manifest symbols",
                &format!("the symbol {symbol} is used twice"),
            ));
        }
    }

    Ok(())
}

fn check_links(links: &[LinkType]) -> Result<(), HostError> {
    let mut names = BTreeSet::new();

    for link in links {
        check_name("manifest.links", &link.name)?;

        if !names.insert(link.name.as_str()) {
            return Err(bad(
                "manifest.links",
                &format!("the link type {} is declared twice", link.name),
            ));
        }

        for kinds in [&link.from, &link.to] {
            if kinds.is_empty() || !kinds.iter().all(|kind| is_entity_kind(kind)) {
                return Err(bad(
                    "manifest.links",
                    &format!("{} needs <source>:<kind> ends", link.name),
                ));
            }
        }
    }

    Ok(())
}

fn check_table(name: &str, table: &TableInfo) -> Result<(), HostError> {
    let at = format!("manifest.tables.{name}");

    check_name(&at, name)?;

    if RESERVED_TABLES.contains(&name) {
        return Err(bad(&at, &"the name is reserved for the host"));
    }

    for column in table.columns.keys() {
        check_name(&at, column)?;
    }

    if table.primary_key.is_empty() || table.indexes.iter().any(Vec::is_empty) {
        return Err(bad(&at, &"a key or an index with no column"));
    }

    if let Some(column) = table
        .primary_key
        .iter()
        .chain(table.indexes.iter().flatten())
        .find(|column| !table.columns.contains_key(*column))
    {
        return Err(bad(&at, &format!("no column {column}")));
    }

    match table
        .primary_key
        .iter()
        .find(|column| table.columns.get(*column).is_some_and(|info| info.nullable))
    {
        Some(column) => Err(bad(&at, &format!("the key column {column} is nullable"))),
        None => Ok(()),
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use serde::Deserialize;

    use super::*;

    #[derive(Deserialize)]
    struct Cases {
        cases: Vec<Case>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        title: String,
        file: serde_json::Value,
        is_valid: bool,
    }

    #[test]
    fn it_gives_each_shared_manifest_case_the_verdict_of_the_typescript_schema() {
        let cases: Cases = serde_json::from_str(include_str!(
            "../../../packages/schema/src/consumer-manifest/consumer-manifest-cases.json"
        ))
        .expect("the case file");

        let wrong: Vec<(String, bool, String)> = cases
            .cases
            .into_iter()
            .filter_map(|case| {
                let result = read_build_manifest_text(&case.file.to_string());

                (result.is_ok() != case.is_valid).then(|| {
                    (
                        case.title,
                        case.is_valid,
                        result
                            .err()
                            .map(|error| error.to_string())
                            .unwrap_or_default(),
                    )
                })
            })
            .collect();

        assert_eq!(wrong, Vec::new());
    }

    #[test]
    fn it_names_the_unknown_field_of_a_file_from_a_newer_build() {
        let result =
            read_build_manifest_text(r#"{"kit":1,"deployment":null,"consumers":[],"x":1}"#);

        assert!(
            matches!(&result, Err(HostError::BadManifest { reason, .. }) if reason.contains("unknown field `x`")),
            "{result:?}"
        );
    }

    #[test]
    fn it_reads_back_the_version_file_it_writes() {
        let directory = tempfile::tempdir().expect("a directory");
        let cases: Cases = serde_json::from_str(include_str!(
            "../../../packages/schema/src/consumer-manifest/consumer-manifest-cases.json"
        ))
        .expect("the case file");
        let file = read_build_manifest_text(&cases.cases[0].file.to_string()).expect("the stub");
        let version = file.consumers[0].to_version();

        write_version(directory.path(), &version).expect("a written version");

        assert_eq!(
            read_version(directory.path()).expect("a read version"),
            version
        );
    }
}
