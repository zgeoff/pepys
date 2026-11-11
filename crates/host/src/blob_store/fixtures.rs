//! The blob store fixtures that `packages/ingest` holds, and the runner that plays one on an
//! adapter.

use serde_json::{Value, json};

use super::BlobStore;
use crate::error::HostError;

/// Calls `$callback!` with each fixture's test name and file name.
macro_rules! for_each_blob_store_fixture {
    ($callback:ident) => {
        $callback! {
            it_reports_a_missing_blob_for_an_unknown_hash => "read-missing.json",
            it_returns_the_same_hash_for_the_same_bytes_written_twice => "write-twice.json",
            it_stores_a_blob_under_the_sha256_of_its_bytes => "write-under-hash.json",
        }
    };
}

pub(crate) use for_each_blob_store_fixture;

macro_rules! fixture_texts {
    ($($name:ident => $file:literal),* $(,)?) => {
        /// Each fixture's file name and text.
        pub const BLOB_STORE_FIXTURES: &[(&str, &str)] = &[$((
            $file,
            include_str!(concat!("../../../../packages/ingest/src/blob-store/fixtures/", $file)),
        )),*];
    };
}

for_each_blob_store_fixture!(fixture_texts);

/// One fixture: each call with what it returns.
pub struct Fixture {
    calls: Vec<Value>,
}

impl Fixture {
    /// The fixture in the file called `file`.
    ///
    /// # Panics
    /// When no fixture has that name or its text is not a fixture.
    #[must_use]
    pub fn find(file: &str) -> Self {
        let (_, text) = BLOB_STORE_FIXTURES
            .iter()
            .find(|(name, _)| *name == file)
            .unwrap_or_else(|| panic!("no blob store fixture {file}"));
        let json: Value = serde_json::from_str(text).unwrap_or_else(|_| panic!("{file} is JSON"));

        Self {
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

/// Runs each call in turn and returns what each returned, in the fixture's form: bytes as the UTF-8
/// text they hold.
///
/// # Panics
/// When a fixture names no text, or a read returns bytes that are not UTF-8.
pub async fn run_blob_store_fixture(store: &impl BlobStore, fixture: &Fixture) -> Vec<Value> {
    let mut returned = Vec::new();

    for call in &fixture.calls {
        returned.push(run_call(store, call).await);
    }

    returned
}

async fn run_call(store: &impl BlobStore, call: &Value) -> Value {
    if let Some(write) = call.get("write") {
        let hash = store.write(text_of(&write["text"]).as_bytes()).await;

        return to_result_form(hash.map(Value::from));
    }

    let bytes = store.read(text_of(&call["read"]["hash"])).await;

    to_result_form(bytes.map(|bytes| {
        let text = String::from_utf8(bytes).unwrap_or_else(|_| panic!("a blob holds UTF-8"));

        json!({"text": text})
    }))
}

fn text_of(value: &Value) -> &str {
    value
        .as_str()
        .unwrap_or_else(|| panic!("{value} is a string"))
}

fn to_result_form(result: Result<Value, HostError>) -> Value {
    match result {
        Ok(value) => json!({"ok": true, "value": value}),
        Err(HostError::MissingBlob(_)) => json!({"ok": false, "failure": {"reason": "missing"}}),
        Err(HostError::BlobUnavailable(_)) => {
            json!({"ok": false, "failure": {"reason": "unavailable"}})
        }
        Err(error) => panic!("a blob result the fixtures have a form for: {error}"),
    }
}
