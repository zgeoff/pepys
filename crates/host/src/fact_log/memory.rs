//! A log held in memory, for tests.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use super::envelope::is_fact_envelope;
use super::{AppendOutcome, FactLog, RejectReason, StoredFact};
use crate::error::HostError;

/// A log held in memory, whose record at index `n` of a stream has offset `n`.
pub struct MemoryLog {
    state: Mutex<MemoryState>,
}

struct MemoryState {
    streams: HashMap<String, Vec<StoredFact>>,
    is_reply_lost: bool,
}

impl MemoryLog {
    /// A log that holds each of `streams`, empty.
    #[must_use]
    pub fn new(streams: &[String]) -> Self {
        Self {
            state: Mutex::new(MemoryState {
                streams: streams
                    .iter()
                    .map(|stream| (stream.clone(), Vec::new()))
                    .collect(),
                is_reply_lost: false,
            }),
        }
    }

    /// A log that holds one stream with `bodies` as its records, stored as they are.
    #[must_use]
    pub fn seeded(stream: &str, bodies: &[&str]) -> Self {
        let records = bodies
            .iter()
            .zip(0_u64..)
            .map(|(body, offset)| StoredFact {
                offset,
                body: (*body).to_owned(),
                appended_at_ms: now_ms(),
            })
            .collect();

        Self {
            state: Mutex::new(MemoryState {
                streams: HashMap::from([(stream.to_owned(), records)]),
                is_reply_lost: false,
            }),
        }
    }

    /// Stores the next append and reports its outcome as unknown, as when a reply is lost.
    ///
    /// # Panics
    /// When a thread panicked while it held the log.
    pub fn lose_next_reply(&self) {
        self.lock().is_reply_lost = true;
    }

    fn collect_records(
        &self,
        stream: &str,
        from: u64,
        count: usize,
    ) -> Result<Vec<StoredFact>, HostError> {
        let state = self.lock();
        let records = state
            .streams
            .get(stream)
            .ok_or_else(|| HostError::UnknownStream(stream.to_owned()))?;
        let start = usize::try_from(from).map_err(|_| HostError::OutOfBounds)?;

        Ok(records.iter().skip(start).take(count).cloned().collect())
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, MemoryState> {
        self.state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

impl FactLog for MemoryLog {
    fn append(
        &self,
        stream: &str,
        body: &str,
        expected_tail: u64,
    ) -> impl Future<Output = Result<AppendOutcome, HostError>> + Send {
        let mut state = self.lock();
        let outcome = append_record(state.streams.get_mut(stream), body, expected_tail);
        let is_reply_lost =
            state.is_reply_lost && matches!(outcome, AppendOutcome::Acknowledged { .. });

        state.is_reply_lost = false;

        std::future::ready(Ok(if is_reply_lost {
            AppendOutcome::Unknown
        } else {
            outcome
        }))
    }

    fn read(
        &self,
        stream: &str,
        from: u64,
        count: usize,
    ) -> impl Future<Output = Result<Vec<StoredFact>, HostError>> + Send {
        std::future::ready(self.collect_records(stream, from, count))
    }

    fn read_tail(&self, stream: &str) -> impl Future<Output = Result<u64, HostError>> + Send {
        std::future::ready(
            self.collect_records(stream, 0, usize::MAX)
                .map(|records| records.len() as u64),
        )
    }
}

fn append_record(
    records: Option<&mut Vec<StoredFact>>,
    body: &str,
    expected_tail: u64,
) -> AppendOutcome {
    if !is_fact_envelope(body) {
        return AppendOutcome::Rejected(RejectReason::InvalidEnvelope);
    }

    let Some(records) = records else {
        return AppendOutcome::Rejected(RejectReason::UnknownStream);
    };
    let offset = records.len() as u64;

    if expected_tail != offset {
        return AppendOutcome::Rejected(RejectReason::TailMismatch);
    }

    records.push(StoredFact {
        offset,
        body: body.to_owned(),
        appended_at_ms: now_ms(),
    });

    AppendOutcome::Acknowledged { offset }
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::*;

    const FACT: &str = r#"{"id":"manual:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","type":"link.asserted","v":1,"api":"pepys/1","entity":"gmail:msg:17","at":"2026-10-01T08:00:00Z","payload":{}}"#;

    #[tokio::test]
    async fn it_reports_an_unknown_outcome_for_an_append_whose_reply_is_lost() {
        let log = MemoryLog::new(&["facts.manual.link".to_owned()]);

        log.lose_next_reply();

        let outcome = log
            .append("facts.manual.link", FACT, 0)
            .await
            .expect("an outcome");

        assert_eq!(outcome, AppendOutcome::Unknown);
    }

    #[tokio::test]
    async fn it_stores_an_append_whose_reply_is_lost() {
        let log = MemoryLog::new(&["facts.manual.link".to_owned()]);

        log.lose_next_reply();
        log.append("facts.manual.link", FACT, 0)
            .await
            .expect("an outcome");

        let tail = log.read_tail("facts.manual.link").await.expect("a tail");

        assert_eq!(tail, 1);
    }

    #[tokio::test]
    async fn it_rejects_a_repeat_of_an_append_whose_reply_is_lost_as_a_tail_mismatch() {
        let log = MemoryLog::new(&["facts.manual.link".to_owned()]);

        log.lose_next_reply();
        log.append("facts.manual.link", FACT, 0)
            .await
            .expect("an outcome");

        let outcome = log
            .append("facts.manual.link", FACT, 0)
            .await
            .expect("an outcome");

        assert_eq!(outcome, AppendOutcome::Rejected(RejectReason::TailMismatch));
    }

    #[tokio::test]
    async fn it_reads_the_seeded_bodies_from_their_offsets() {
        let log = MemoryLog::seeded("facts.github.pull_request", &["a", "b", "c"]);

        let bodies: Vec<(u64, String)> = log
            .read("facts.github.pull_request", 1, 5)
            .await
            .expect("the records")
            .into_iter()
            .map(|fact| (fact.offset, fact.body))
            .collect();

        assert_eq!(bodies, vec![(1, "b".to_owned()), (2, "c".to_owned())]);
    }
}
