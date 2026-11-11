//! The checks an append runs before it reaches a stream, the same as the TypeScript adapters run.

use super::RejectReason;
use super::envelope::is_fact_envelope;

/// The limits of one s2-lite append. A record meters as its body in UTF-8 bytes plus 8.
const MAX_RECORDS: usize = 1000;
const MAX_METERED_BYTES: usize = 1_048_576;
const RECORD_OVERHEAD_BYTES: usize = 8;

/// Why `bodies` cannot be appended, or `None`. An empty batch, or one over the record limit, is too
/// large; then each body must be an envelope; then the batch must fit the byte limit.
pub fn find_batch_problem(bodies: &[String]) -> Option<RejectReason> {
    if bodies.is_empty() || bodies.len() > MAX_RECORDS {
        return Some(RejectReason::TooLarge);
    }

    if let Some(index) = bodies.iter().position(|body| !is_fact_envelope(body)) {
        return Some(RejectReason::InvalidEnvelope { index });
    }

    let metered: usize = bodies
        .iter()
        .map(|body| body.len() + RECORD_OVERHEAD_BYTES)
        .sum();

    (metered > MAX_METERED_BYTES).then_some(RejectReason::TooLarge)
}
