//! The log on s2-lite.

use std::num::NonZeroU32;
use std::time::Duration;

use s2_sdk::error::{AppendConditionFailed, AppendError, ReadError, ServerError};
use s2_sdk::types::{
    AppendInput, AppendRecord, AppendRecordBatch, BasinName, ReadFrom, ReadInput, ReadLimits,
    ReadStart, ReadStop, RetryConfig, S2Config, S2Endpoints, SequencedRecord, StreamName,
};
use s2_sdk::{S2, S2Basin, S2Stream};

use super::envelope::is_fact_envelope;
use super::{AppendOutcome, FactLog, RejectReason, StoredFact};
use crate::error::HostError;

/// Where the log is and how to reach it.
#[derive(Debug, Clone)]
pub struct S2Settings {
    pub endpoint: String,
    pub access_token: String,
    pub basin: String,
}

/// The streams of one basin.
pub struct S2Log {
    basin: S2Basin,
}

const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

fn to_stream_error(error: impl std::fmt::Display) -> HostError {
    HostError::Stream(error.to_string())
}

impl S2Log {
    /// # Errors
    /// Fails when the endpoint or the basin name is not valid.
    pub fn connect(settings: &S2Settings) -> Result<Self, HostError> {
        let client = S2::new(build_config(settings)?).map_err(to_stream_error)?;

        Self::from_client(&client, &settings.basin)
    }

    /// # Errors
    /// Fails when the basin name is not valid.
    pub fn from_client(client: &S2, basin: &str) -> Result<Self, HostError> {
        let basin_name: BasinName = basin.parse().map_err(to_stream_error)?;

        Ok(Self {
            basin: client.basin(basin_name),
        })
    }

    fn stream(&self, stream: &str) -> Result<S2Stream, HostError> {
        let stream_name: StreamName = stream.parse().map_err(to_stream_error)?;

        Ok(self.basin.stream(stream_name))
    }
}

/// The client settings: one attempt per call, since a client retry could store a record twice
/// before the writer knows, and the writer owns retries.
///
/// # Errors
/// Fails when the endpoint is not valid.
pub fn build_config(settings: &S2Settings) -> Result<S2Config, HostError> {
    Ok(S2Config::new(settings.access_token.as_str())
        .with_endpoints(S2Endpoints::for_endpoint(&settings.endpoint).map_err(to_stream_error)?)
        .with_request_timeout(REQUEST_TIMEOUT)
        .with_retry(RetryConfig::new().with_max_attempts(NonZeroU32::MIN)))
}

impl FactLog for S2Log {
    async fn append(
        &self,
        stream: &str,
        body: &str,
        expected_tail: u64,
    ) -> Result<AppendOutcome, HostError> {
        if !is_fact_envelope(body) {
            return Ok(AppendOutcome::Rejected(RejectReason::InvalidEnvelope));
        }

        let record = AppendRecord::new(body.to_owned()).map_err(to_stream_error)?;
        let records = AppendRecordBatch::try_from_iter([record]).map_err(to_stream_error)?;
        let input = AppendInput::new(records).with_match_seq_num(expected_tail);

        match self.stream(stream)?.append(input).await {
            Ok(ack) => Ok(AppendOutcome::Acknowledged {
                offset: ack.start.seq_num,
            }),
            Err(error) => find_append_outcome(&error).ok_or_else(|| to_stream_error(error)),
        }
    }

    async fn read(
        &self,
        stream: &str,
        from: u64,
        count: usize,
    ) -> Result<Vec<StoredFact>, HostError> {
        let input = ReadInput::new()
            .with_start(ReadStart::new().with_from(ReadFrom::SeqNum(from)))
            .with_stop(ReadStop::new().with_limits(ReadLimits::new().with_count(count)));

        match self.stream(stream)?.read(input).await {
            Ok(batch) => batch.records.iter().map(to_stored_fact).collect(),
            // s2-lite answers 416 to a read that starts at the tail or past it.
            Err(ReadError::ReadUnwritten(_)) => Ok(Vec::new()),
            Err(error) => Err(to_read_error(stream, &error)),
        }
    }

    async fn read_tail(&self, stream: &str) -> Result<u64, HostError> {
        let position = self
            .stream(stream)?
            .check_tail()
            .await
            .map_err(|error| to_read_error(stream, &error))?;

        Ok(position.seq_num)
    }
}

/// A client error from the server means the record was not stored; 408 and 429 ask for a retry. A
/// refusal the outcomes have no reason for, such as a bad token, returns `None`.
fn find_append_outcome(error: &AppendError) -> Option<AppendOutcome> {
    if matches!(error, AppendError::IndefiniteFailure { .. }) {
        return Some(AppendOutcome::Unknown);
    }

    if matches!(
        error,
        AppendError::ConditionFailed(AppendConditionFailed::SeqNumMismatch(_))
    ) {
        return Some(AppendOutcome::Rejected(RejectReason::TailMismatch));
    }

    let server = error
        .request_error()
        .and_then(|request| request.server_error());

    if server.is_some_and(is_unknown_stream) {
        return Some(AppendOutcome::Rejected(RejectReason::UnknownStream));
    }

    if server.is_some_and(is_definite_refusal) {
        return None;
    }

    Some(AppendOutcome::Unknown)
}

fn is_unknown_stream(error: &ServerError) -> bool {
    error.status.as_u16() == 404 && error.code == "stream_not_found"
}

fn is_definite_refusal(error: &ServerError) -> bool {
    error.status.is_client_error() && !matches!(error.status.as_u16(), 408 | 429)
}

fn to_stored_fact(record: &SequencedRecord) -> Result<StoredFact, HostError> {
    Ok(StoredFact {
        offset: record.seq_num,
        body: String::from_utf8(record.body.to_vec()).map_err(to_stream_error)?,
        appended_at_ms: record.timestamp,
    })
}

fn to_read_error(stream: &str, error: &ReadError) -> HostError {
    let server = error
        .request_error()
        .and_then(|request| request.server_error());

    if server.is_some_and(is_unknown_stream) {
        HostError::UnknownStream(stream.to_owned())
    } else {
        to_stream_error(error)
    }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    use super::*;
    use crate::test_utils::stub_s2::{
        STUB_S2_HOST, StubS2State, TurmoilConnector, WRITER_HOST, serve_stub_s2,
    };

    const FACT: &str = r#"{"id":"manual:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","type":"link.asserted","v":1,"api":"pepys/1","entity":"gmail:msg:17","at":"2026-10-01T08:00:00Z","payload":{}}"#;

    /// Runs `appends` on a log that reaches the stub over turmoil's simulated network, with the
    /// reply to the first append held back until it times out, and returns each outcome.
    fn run_appends_with_first_reply_lost(appends: usize) -> Vec<AppendOutcome> {
        let state = Arc::new(Mutex::new(StubS2State {
            records: 0,
            is_next_reply_held: true,
        }));
        let outcomes = Arc::new(Mutex::new(Vec::new()));
        let mut sim = turmoil::Builder::new()
            .simulation_duration(Duration::from_secs(60))
            .build();
        let served = Arc::clone(&state);

        sim.host(STUB_S2_HOST, move || serve_stub_s2(Arc::clone(&served)));

        let recorded = Arc::clone(&outcomes);

        sim.client(WRITER_HOST, async move {
            let settings = S2Settings {
                endpoint: format!("http://{STUB_S2_HOST}"),
                access_token: "unused".to_owned(),
                basin: "conformance".to_owned(),
            };
            let client = S2::new_with_connector(build_config(&settings)?, TurmoilConnector)?;
            let log = S2Log::from_client(&client, &settings.basin)?;

            for _ in 0..appends {
                let outcome = log.append("facts.manual.link", FACT, 0).await?;

                turmoil::release(STUB_S2_HOST, WRITER_HOST);
                recorded.lock().expect("the outcomes").push(outcome);
            }

            Ok(())
        });

        sim.run().expect("the simulation");

        outcomes.lock().expect("the outcomes").clone()
    }

    #[test]
    fn it_reports_an_unknown_outcome_for_an_append_whose_reply_is_lost() {
        let outcomes = run_appends_with_first_reply_lost(1);

        assert_eq!(outcomes, vec![AppendOutcome::Unknown]);
    }

    #[test]
    fn it_rejects_a_repeat_of_an_append_whose_reply_is_lost_as_a_tail_mismatch() {
        let outcomes = run_appends_with_first_reply_lost(2);

        assert_eq!(
            outcomes,
            vec![
                AppendOutcome::Unknown,
                AppendOutcome::Rejected(RejectReason::TailMismatch)
            ]
        );
    }
}
