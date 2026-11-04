import type { FactEnvelope, Result } from '@pepys/schema';
import type { FactID, StreamName, StreamOffset } from './ids.ts';

// The outcome of one append. s2-lite can land an append whose call timed out, so an unknown outcome
// is its own case: the caller repeats the append under the same fact ID, and the log keeps one copy.
export type AppendOutcome =
  | { kind: 'acknowledged'; offset: StreamOffset }
  | { kind: 'duplicate'; id: FactID }
  | { kind: 'rejected'; reason: 'invalid-envelope' | 'unknown-stream' }
  | { kind: 'unknown' };

export interface StoredFact {
  offset: StreamOffset;
  fact: FactEnvelope<unknown>;
}

// The driven port to the log. Adapters: s2-lite, and an in-memory log for tests. The host declares
// the same port as a Rust trait, and one set of fixture files drives a conformance test on each.
export interface FactLog {
  append: (stream: StreamName, fact: FactEnvelope<unknown>) => Promise<AppendOutcome>;

  // Reads up to `count` facts from `from`. An empty list means the reader has reached the tail.
  read: (
    stream: StreamName,
    from: StreamOffset,
    count: number,
  ) => Promise<Result<readonly StoredFact[], { reason: 'unknown-stream' }>>;

  // The offset that the next append will take.
  readTail: (stream: StreamName) => Promise<Result<StreamOffset, { reason: 'unknown-stream' }>>;
}
