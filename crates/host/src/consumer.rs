use pepys_schema::{GITHUB_PULL_REQUEST_READS, ReadImport};

use crate::error::HostError;
use crate::pull_request_rows::TABLE;

/// What the host knows about one consumer: the stream it tails, the schema of its file, the tables
/// it owns and the reads its module imports.
pub struct ConsumerSpec {
    pub name: &'static str,
    pub stream: &'static str,
    pub schema: &'static str,
    pub tables: &'static [&'static str],
    pub reads: &'static [ReadImport],
}

const GITHUB_PULL_REQUEST: ConsumerSpec = ConsumerSpec {
    name: "github_pull_request",
    stream: "facts.github.pull_request",
    schema: include_str!("../../../packages/source-github/src/generated/github-pull-request.sql"),
    tables: &[TABLE],
    reads: &GITHUB_PULL_REQUEST_READS,
};

/// Finds the consumer called `name`.
///
/// # Errors
/// Fails when the host has no consumer of that name.
pub fn find_consumer(name: &str) -> Result<&'static ConsumerSpec, HostError> {
    if name == GITHUB_PULL_REQUEST.name {
        Ok(&GITHUB_PULL_REQUEST)
    } else {
        Err(HostError::UnknownConsumer(name.to_owned()))
    }
}
