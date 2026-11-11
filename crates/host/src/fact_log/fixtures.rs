//! The fact log fixtures that `packages/ingest` holds, and the runner that plays one on an adapter.

use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use super::{AppendOutcome, FactLog, RejectReason, StoredFact};
use crate::error::HostError;

/// Calls `$callback!` with each fixture's test name and file name.
macro_rules! for_each_fact_log_fixture {
    ($callback:ident) => {
        $callback! {
            it_acknowledges_an_append_with_the_next_offset => "append-batch-acknowledged.json",
            it_acknowledges_an_append_whose_expected_tail_is_the_tail => "append-batch-at-expected-tail.json",
            it_rejects_an_append_whose_expected_tail_is_behind_the_tail => "append-batch-behind-tail.json",
            it_rejects_a_list_with_an_envelope_that_fails_the_envelope_parse => "append-batch-invalid-envelope.json",
            it_rejects_a_list_over_the_record_limit => "append-batch-limit-records.json",
            it_acknowledges_a_list_with_the_offset_of_the_first_and_the_count => "append-batch-multiple.json",
            it_rejects_an_empty_list_and_a_list_over_the_byte_limit => "append-batch-too-large.json",
            it_rejects_an_append_to_a_stream_that_does_not_exist => "append-batch-unknown-stream.json",
            it_returns_an_empty_list_for_a_read_at_the_tail => "read-at-tail.json",
            it_returns_each_body_and_appended_at_time_on_read => "read-body-and-appended-at.json",
            it_reads_facts_in_append_order_from_an_offset => "read-in-append-order.json",
            it_reports_the_tail_as_the_offset_of_the_next_append => "read-tail.json",
            it_rejects_a_read_of_a_stream_that_does_not_exist => "read-unknown-stream.json",
        }
    };
}

pub(crate) use for_each_fact_log_fixture;

macro_rules! fixture_texts {
    ($($name:ident => $file:literal),* $(,)?) => {
        /// Each fixture's file name and text.
        pub const FACT_LOG_FIXTURES: &[(&str, &str)] = &[$((
            $file,
            include_str!(concat!("../../../../packages/ingest/src/fact-log/fixtures/", $file)),
        )),*];
    };
}

for_each_fact_log_fixture!(fixture_texts);

/// One fixture: the streams the log starts with, and each call with what it returns.
pub struct Fixture {
    pub streams: Vec<String>,
    calls: Vec<Value>,
}

impl Fixture {
    /// The fixture in the file called `file`.
    ///
    /// # Panics
    /// When no fixture has that name or its text is not a fixture.
    #[must_use]
    pub fn find(file: &str) -> Self {
        let (_, text) = FACT_LOG_FIXTURES
            .iter()
            .find(|(name, _)| *name == file)
            .unwrap_or_else(|| panic!("no fact log fixture {file}"));
        let json: Value = serde_json::from_str(text).unwrap_or_else(|_| panic!("{file} is JSON"));

        Self {
            streams: json["streams"]
                .as_array()
                .unwrap_or_else(|| panic!("{file} lists its streams"))
                .iter()
                .map(|stream| text_of(stream).to_owned())
                .collect(),
            calls: json["calls"]
                .as_array()
                .unwrap_or_else(|| panic!("{file} lists its calls"))
                .clone(),
        }
    }

    /// What each call should return, in the order of the calls.
    #[must_use]
    pub fn expected_returns(&self) -> Vec<Value> {
        self.calls
            .iter()
            .map(|call| call["returns"].clone())
            .collect()
    }
}

/// Runs each call in turn and returns what each returned, in the fixture's form: a body as the JSON
/// it holds, and an appended-at time inside the run as "during-fixture".
///
/// # Panics
/// When a call fails in a way the fixtures have no form for.
pub async fn run_fact_log_fixture(log: &impl FactLog, fixture: &Fixture) -> Vec<Value> {
    let start_ms = now_ms();
    let mut returned = Vec::new();

    for call in &fixture.calls {
        returned.push(run_call(log, call, start_ms).await);
    }

    returned
}

async fn run_call(log: &impl FactLog, call: &Value, start_ms: u64) -> Value {
    if let Some(append) = call.get("appendBatch") {
        let bodies = expand_facts(&append["facts"]);
        let outcome = log
            .append_batch(
                text_of(&append["stream"]),
                &bodies,
                number_of(&append["expectedTail"]),
            )
            .await
            .unwrap_or_else(|error| panic!("an append outcome: {error}"));

        return to_outcome_form(outcome);
    }

    if let Some(read_tail) = call.get("readTail") {
        let tail = log.read_tail(text_of(&read_tail["stream"])).await;

        return to_result_form(tail.map(|offset| json!(offset)));
    }

    let read = &call["read"];
    let count = usize::try_from(number_of(&read["count"])).unwrap_or(usize::MAX);
    let facts = log
        .read(text_of(&read["stream"]), number_of(&read["from"]), count)
        .await;
    let end_ms = now_ms();

    to_result_form(facts.map(|facts| {
        facts
            .iter()
            .map(|fact| to_stored_form(fact, start_ms, end_ms))
            .collect()
    }))
}

/// The body of each fact of a list. An item is an envelope, or a wrapper that repeats its `fact`
/// `repeat` times and, with `payloadPadBytes`, sets its payload to `{"pad": <that many "x">}`.
fn expand_facts(items: &Value) -> Vec<String> {
    items
        .as_array()
        .unwrap_or_else(|| panic!("{items} is a list of facts"))
        .iter()
        .flat_map(|item| {
            let Some(fact) = item.get("fact") else {
                return vec![item.to_string()];
            };
            let mut fact = fact.clone();

            if let Some(pad) = item.get("payloadPadBytes") {
                let pad = usize::try_from(number_of(pad)).unwrap_or(usize::MAX);

                fact["payload"] = json!({"pad": "x".repeat(pad)});
            }

            let repeat = item.get("repeat").map_or(1, number_of);

            vec![fact.to_string(); usize::try_from(repeat).unwrap_or(usize::MAX)]
        })
        .collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| {
            u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX)
        })
}

fn text_of(value: &Value) -> &str {
    value
        .as_str()
        .unwrap_or_else(|| panic!("{value} is a string"))
}

fn number_of(value: &Value) -> u64 {
    value
        .as_u64()
        .unwrap_or_else(|| panic!("{value} is a whole number"))
}

fn to_outcome_form(outcome: AppendOutcome) -> Value {
    match outcome {
        AppendOutcome::Acknowledged {
            first_offset,
            count,
        } => json!({"kind": "acknowledged", "firstOffset": first_offset, "count": count}),
        AppendOutcome::Rejected(RejectReason::InvalidEnvelope { index }) => {
            json!({"kind": "rejected", "reason": "invalid-envelope", "index": index})
        }
        AppendOutcome::Rejected(reason) => {
            let reason = match reason {
                RejectReason::InvalidEnvelope { .. } => unreachable!("matched above"),
                RejectReason::UnknownStream => "unknown-stream",
                RejectReason::TailMismatch => "tail-mismatch",
                RejectReason::TooLarge => "too-large",
            };

            json!({"kind": "rejected", "reason": reason})
        }
        AppendOutcome::Unknown => json!({"kind": "unknown"}),
    }
}

fn to_result_form(result: Result<Value, HostError>) -> Value {
    match result {
        Ok(value) => json!({"ok": true, "value": value}),
        Err(HostError::UnknownStream(_)) => {
            json!({"ok": false, "failure": {"reason": "unknown-stream"}})
        }
        Err(error) => panic!("a read the fixtures have a form for: {error}"),
    }
}

fn to_stored_form(fact: &StoredFact, start_ms: u64, end_ms: u64) -> Value {
    let body: Value = serde_json::from_str(&fact.body)
        .unwrap_or_else(|_| panic!("the body at {} is JSON", fact.offset));
    let appended_at = if (start_ms..=end_ms).contains(&fact.appended_at_ms) {
        json!("during-fixture")
    } else {
        json!(fact.appended_at_ms)
    };

    json!({"offset": fact.offset, "body": body, "appendedAtMs": appended_at})
}
