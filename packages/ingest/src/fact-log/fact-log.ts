import type { FactEnvelope, Result, StreamName, StreamOffset } from '@pepys/kit';

// Fact `i` of an acknowledged batch has the offset `firstOffset + i`.
export type AppendBatchOutcome =
  | { kind: 'acknowledged'; firstOffset: StreamOffset; count: number }

  // Nothing was stored.
  | { kind: 'rejected'; reason: 'tail-mismatch' | 'unknown-stream' | 'too-large' }
  | { kind: 'rejected'; reason: 'invalid-envelope'; index: number }

  // The reply was lost: the batch is stored whole, or not at all.
  | { kind: 'unknown' };

export interface StoredFact {
  offset: StreamOffset;
  fact: FactEnvelope<unknown>;
  body: string;
  appendedAtMs: number;
}

export interface FactLog {
  // Stores every fact, in order, in one append that the log refuses unless the stream's tail is
  // `expectedTail`. All the facts land or none does.
  appendBatch: (
    stream: StreamName,
    facts: readonly FactEnvelope<unknown>[],
    expectedTail: StreamOffset,
  ) => Promise<AppendBatchOutcome>;
  read: (
    stream: StreamName,
    from: StreamOffset,
    count: number,
  ) => Promise<Result<readonly StoredFact[], { reason: 'unknown-stream' }>>;
  readTail: (stream: StreamName) => Promise<Result<StreamOffset, { reason: 'unknown-stream' }>>;
}
