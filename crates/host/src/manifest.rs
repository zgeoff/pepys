//! SPIKE. The consumer manifest of the v1 design (03-manifest-host.ts, part D), the fields the
//! scope path uses. No `read_build_manifest` rules.

use std::collections::BTreeMap;

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ConsumerManifest {
    pub name: String,
    pub input: ConsumerInput,
    pub exports: Exports,
    pub imports: Vec<Read>,
    pub tables: BTreeMap<String, TableInfo>,
    pub links: Vec<LinkType>,
    pub schema: String,
}

#[derive(Debug, Clone, Deserialize)]
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

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Exports {
    pub init: String,
    pub apply: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Read {
    Row {
        table: String,
        length: String,
        into: String,
    },
    ScopeFacts {
        length: String,
        into: String,
    },
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TableInfo {
    pub columns: BTreeMap<String, ColumnInfo>,
    pub primary_key: Vec<String>,
    pub indexes: Vec<Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ColumnInfo {
    pub kind: ColumnKind,
    pub nullable: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
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

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LinkType {
    pub name: String,
    pub from: Vec<String>,
    pub to: Vec<String>,
    pub hub: bool,
}
