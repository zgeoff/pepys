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
}
