use thiserror::Error;

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
    // SPIKE: the design's new variants that the scope path needs.
    #[error("the consumer declares no link type {link_type}")]
    LinkNotDeclared { link_type: String },
    #[error("a {link_type} link cannot have {id} as its {end} end")]
    LinkKinds {
        link_type: String,
        end: &'static str,
        id: String,
    },
    #[error("a {link_type} link is refused: {reason}")]
    LinkValue {
        link_type: String,
        reason: &'static str,
    },
    #[error("scope {scope} returned {table} {key}, which scope {owner} owns")]
    ScopeConflict {
        scope: String,
        table: String,
        key: String,
        owner: String,
    },
    #[error("scope {scope} asked for the facts of {asked}")]
    ForeignScopeRead { scope: String, asked: String },
}
