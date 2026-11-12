import type { StreamOffset } from '@pepys/kit';
import { P, match } from 'ts-pattern';
import type { AppendBatchOutcome } from './fact-log.ts';

export interface StoredRun {
  firstOffset: StreamOffset;
  count: number;
}

// a reason the log gives that no retry changes
export interface StopFailure {
  kind: 'refused';
  reason: 'unknown-stream' | 'invalid-envelope' | 'too-large';
}

// What one attempt leaves: the answer, or the tail that earlier attempts with an unknown outcome
// aimed at, which a later attempt can still land on. `null` when no such attempt is open.
export type AttemptResult =
  | { kind: 'stored'; stored: StoredRun }
  | { kind: 'refused'; failure: StopFailure }
  | { kind: 'again'; pendingTail: StreamOffset | null };

// `settle`: read the offsets from `tail` to learn whether the run is there.
export type AttemptStep = AttemptResult | { kind: 'settle'; tail: StreamOffset };

// What follows an append that aimed at `aimed`. A tail mismatch with no attempt open means another
// writer moved the tail, so the next attempt reads it again. With an attempt open, the mismatch may
// be that attempt landing late, so the offsets it aimed at are read.
export function pickAttemptStep(
  outcome: AppendBatchOutcome,
  aimed: StreamOffset,
  pendingTail: StreamOffset | null,
): AttemptStep {
  return match(outcome)
    .with({ kind: 'acknowledged' }, (acknowledged) => ({
      kind: 'stored' as const,
      stored: { firstOffset: acknowledged.firstOffset, count: acknowledged.count },
    }))
    .with({ kind: 'rejected', reason: 'tail-mismatch' }, () =>
      pendingTail === null
        ? { kind: 'again' as const, pendingTail }
        : { kind: 'settle' as const, tail: aimed },
    )
    .with(
      { kind: 'rejected', reason: P.union('unknown-stream', 'invalid-envelope', 'too-large') },
      (rejected) => ({
        kind: 'refused' as const,
        failure: { kind: 'refused' as const, reason: rejected.reason },
      }),
    )
    .with({ kind: 'unknown' }, () => ({ kind: 'settle' as const, tail: aimed }))
    .exhaustive();
}
