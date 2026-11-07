//! The fact log port: append, read and the tail of each stream.

mod envelope;
#[cfg(test)]
pub mod fixtures;
#[cfg(test)]
pub mod memory;
pub mod s2;

use crate::error::HostError;

/// What one append did. A rejected append stored nothing; an unknown one may have been stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppendOutcome {
    Acknowledged { offset: u64 },
    Rejected(RejectReason),
    Unknown,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RejectReason {
    InvalidEnvelope,
    UnknownStream,
    TailMismatch,
}

/// One record of a stream: its offset, the fact JSON as stored, and when the log stored it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredFact {
    pub offset: u64,
    pub body: String,
    pub appended_at_ms: u64,
}

/// The log of facts, one stream per fact family. The offset is the stream's sequence number.
pub trait FactLog {
    /// Appends `body` when the stream's tail is `expected_tail`, so an append whose first attempt
    /// lands late fails its own guard.
    ///
    /// # Errors
    /// Fails on a refusal the outcomes have no reason for, such as a bad token.
    fn append(
        &self,
        stream: &str,
        body: &str,
        expected_tail: u64,
    ) -> impl Future<Output = Result<AppendOutcome, HostError>> + Send;

    /// Up to `count` records from offset `from`. An empty list means `from` is at the tail.
    ///
    /// # Errors
    /// Fails with [`HostError::UnknownStream`] for a stream the log does not hold, and when the log
    /// cannot be read.
    fn read(
        &self,
        stream: &str,
        from: u64,
        count: usize,
    ) -> impl Future<Output = Result<Vec<StoredFact>, HostError>> + Send;

    /// The offset the next append will take, which is also the number of records.
    ///
    /// # Errors
    /// Fails with [`HostError::UnknownStream`] for a stream the log does not hold, and when the log
    /// cannot be reached.
    fn read_tail(&self, stream: &str) -> impl Future<Output = Result<u64, HostError>> + Send;
}

#[cfg(test)]
mod tests {
    use super::fixtures::{FACT_LOG_FIXTURES, Fixture, run_fact_log_fixture};
    use super::memory::MemoryLog;
    use crate::test_utils::collect_fixture_files;

    macro_rules! memory_log_tests {
        ($($name:ident => $file:literal),* $(,)?) => {$(
            #[tokio::test]
            async fn $name() {
                let fixture = Fixture::find($file);
                let log = MemoryLog::new(&fixture.streams);

                let returned = run_fact_log_fixture(&log, &fixture).await;

                assert_eq!(returned, fixture.expected_returns());
            }
        )*};
    }

    super::fixtures::for_each_fact_log_fixture!(memory_log_tests);

    #[test]
    fn it_runs_every_fact_log_fixture_file() {
        let listed: Vec<String> = FACT_LOG_FIXTURES
            .iter()
            .map(|(name, _)| (*name).to_owned())
            .collect();

        assert_eq!(listed, collect_fixture_files("fact-log"));
    }
}
