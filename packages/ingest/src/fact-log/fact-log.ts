import type { FactEnvelope, Result, StreamName, StreamOffset } from '@pepys/schema';

export type AppendOutcome =
  | { kind: 'acknowledged'; offset: StreamOffset }
  | { kind: 'rejected'; reason: 'invalid-envelope' | 'unknown-stream' | 'tail-mismatch' }
  | { kind: 'unknown' };

export interface StoredFact {
  offset: StreamOffset;
  fact: FactEnvelope<unknown>;
  body: string;
  appendedAtMs: number;
}

export interface FactLog {
  append: (
    stream: StreamName,
    fact: FactEnvelope<unknown>,
    expectedTail: StreamOffset,
  ) => Promise<AppendOutcome>;
  read: (
    stream: StreamName,
    from: StreamOffset,
    count: number,
  ) => Promise<Result<readonly StoredFact[], { reason: 'unknown-stream' }>>;
  readTail: (stream: StreamName) => Promise<Result<StreamOffset, { reason: 'unknown-stream' }>>;
}
