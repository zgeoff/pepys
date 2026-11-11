use thiserror::Error;

use crate::links::LinkProblem;

#[derive(Debug, Error)]
pub enum HostError {
    #[error("database: {0}")]
    Database(#[from] turso::Error),
    #[error("module: {0}")]
    Module(#[from] wasmtime::Error),
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("s2: {0}")]
    Stream(String),
    #[error("the log has no stream {0}")]
    UnknownStream(String),
    #[error("no blob {0}")]
    MissingBlob(String),
    #[error("the blob store is unavailable: {0}")]
    BlobUnavailable(String),
    #[error("the consumer returned an operation on {table}, which it does not own")]
    NotOwned { table: String },
    #[error("the consumer returned an operation the host cannot read: {0}")]
    BadOperation(String),
    #[error("the consumer returned a row of {table} the host refuses: {reason}")]
    BadRow { table: String, reason: String },
    #[error("the consumer returned a link the host refuses: {0}")]
    BadLink(LinkProblem),
    #[error("the module does not export {0}")]
    MissingExport(String),
    #[error("the module wrote a result outside its memory")]
    OutOfBounds,
    #[error("the consumer panicked: {0}")]
    Panicked(String),
    #[error("unknown consumer {0}")]
    UnknownConsumer(String),
    #[error("a version cannot move from {from} to {to}")]
    Transition { from: String, to: String },
    #[error("version {0} is not recorded")]
    UnknownVersion(String),
    #[error("{0} already has a writer")]
    Locked(String),
    #[error("{0}")]
    Config(String),
    #[error("the manifest is refused at {path}: {reason}")]
    BadManifest { path: String, reason: String },
    #[error("the module file of {consumer} has the hash {found}, and the manifest lists {listed}")]
    ModuleHash {
        consumer: String,
        listed: String,
        found: String,
    },
    #[error("the file does not match the manifest's table {table}: {reason}")]
    SchemaMismatch { table: String, reason: String },
    #[error("{0} has no current version; run pepys up {0}")]
    NoCurrentVersion(String),
    #[error(
        "{consumer} already holds a version {version} built from another manifest; the host refuses two manifests under one version"
    )]
    VersionClash { consumer: String, version: String },
    #[error("{consumer} declares the table {table}, which the current version of {owner} owns")]
    TableOwned {
        consumer: String,
        table: String,
        owner: String,
    },
    #[error("this host runs fact-mode consumers only, and {0} is a scope consumer")]
    ScopeMode(String),
    #[error("the task of {consumer} stopped: {source}")]
    Stopped {
        consumer: String,
        source: Box<HostError>,
    },
    #[error("up {consumer} failed: {source}")]
    Up {
        consumer: String,
        source: Box<HostError>,
    },
}
