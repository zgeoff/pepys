use std::time::Duration;

use crate::error::HostError;

const FIRST_DELAY: Duration = Duration::from_millis(200);
const MAX_DELAY: Duration = Duration::from_secs(30);

/// The consecutive failures after which a consumer's task stops and the `up` of `run --up` ends,
/// even on a store error.
pub const RETRY_LIMIT: u32 = 10;

/// What a consumer's task does after a pass fails, and the `up` of `run --up` after it fails.
#[derive(Debug, PartialEq, Eq)]
pub enum Recovery {
    /// Wait this long, then run the pass again from the committed offsets, or the `up` again from
    /// its start.
    Retry(Duration),
    Stop,
}

/// Retries a store or log error, with a delay that doubles from 200 ms up to 30 s, until
/// `failures` reaches the limit of consecutive failures. Stops at once on any other error, which
/// the consumer's output or the deployment caused, so a retry would fail the same way.
#[must_use]
pub fn pick_recovery(error: &HostError, failures: u32) -> Recovery {
    if !is_store_error(error) || failures >= RETRY_LIMIT {
        return Recovery::Stop;
    }

    let doubled = FIRST_DELAY.saturating_mul(2_u32.saturating_pow(failures.saturating_sub(1)));

    Recovery::Retry(doubled.min(MAX_DELAY))
}

fn is_store_error(error: &HostError) -> bool {
    match error {
        HostError::Database(_) | HostError::Stream(_) | HostError::BlobUnavailable(_) => true,
        HostError::Module(_)
        | HostError::Json(_)
        | HostError::Io(_)
        | HostError::NoRuntime(_)
        | HostError::UnknownStream(_)
        | HostError::MissingBlob(_)
        | HostError::NotOwned { .. }
        | HostError::BadOperation(_)
        | HostError::BadRow { .. }
        | HostError::BadLink(_)
        | HostError::MissingExport(_)
        | HostError::OutOfBounds
        | HostError::Panicked(_)
        | HostError::UnknownConsumer(_)
        | HostError::Transition { .. }
        | HostError::UnknownVersion(_)
        | HostError::Locked(_)
        | HostError::Config(_)
        | HostError::BadManifest { .. }
        | HostError::ModuleHash { .. }
        | HostError::SchemaMismatch { .. }
        | HostError::NoCurrentVersion(_)
        | HostError::VersionClash { .. }
        | HostError::TableOwned { .. }
        | HostError::DuplicateRow { .. }
        | HostError::DuplicateLink { .. }
        | HostError::ScopeConflict { .. }
        | HostError::ForeignScopeRead { .. }
        | HostError::Stopped { .. }
        | HostError::Up { .. } => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_error(kind: &str) -> HostError {
        match kind {
            "database" => HostError::Database(turso::Error::Busy("database is locked".to_owned())),
            "stream" => HostError::Stream("connection reset".to_owned()),
            "blob" => HostError::BlobUnavailable("503".to_owned()),
            "bad-operation" => HostError::BadOperation("a list".to_owned()),
            "bad-row" => HostError::BadRow {
                table: "github_pull_request".to_owned(),
                reason: "no id".to_owned(),
            },
            "panicked" => HostError::Panicked("unreachable".to_owned()),
            "module-hash" => HostError::ModuleHash {
                consumer: "github_pull_request".to_owned(),
                listed: "a".to_owned(),
                found: "b".to_owned(),
            },
            other => panic!("no error kind {other}"),
        }
    }

    #[test]
    fn it_picks_a_retry_for_a_store_error_and_a_stop_for_any_other() {
        let cases = [
            ("database", 1, Recovery::Retry(Duration::from_millis(200))),
            ("stream", 1, Recovery::Retry(Duration::from_millis(200))),
            ("blob", 1, Recovery::Retry(Duration::from_millis(200))),
            ("database", 2, Recovery::Retry(Duration::from_millis(400))),
            ("stream", 4, Recovery::Retry(Duration::from_millis(1_600))),
            (
                "database",
                8,
                Recovery::Retry(Duration::from_millis(25_600)),
            ),
            ("database", 9, Recovery::Retry(Duration::from_secs(30))),
            ("database", 10, Recovery::Stop),
            ("stream", 11, Recovery::Stop),
            ("bad-operation", 1, Recovery::Stop),
            ("bad-row", 1, Recovery::Stop),
            ("panicked", 1, Recovery::Stop),
            ("module-hash", 1, Recovery::Stop),
        ];

        for (kind, failures, expected) in cases {
            assert_eq!(
                (kind, failures, pick_recovery(&build_error(kind), failures)),
                (kind, failures, expected)
            );
        }
    }
}
