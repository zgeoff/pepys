import type { Result, StreamOffset } from '@pepys/kit';
import { match } from 'ts-pattern';
import type { AttemptResult, StopFailure, StoredRun } from './pick-attempt-step.ts';

interface RetryLimits {
  maxAttempts: number;
  retryDelayMs: number;
}

export type RetryStep =
  | {
      kind: 'answer';
      answer: Result<StoredRun, StopFailure | { kind: 'not-stored'; attempts: number }>;
    }
  | { kind: 'retry'; pendingTail: StreamOffset | null; delayMs: number };

// The wait before attempt `attempt + 1` grows by `retryDelayMs` with each attempt.
export function pickRetryStep(
  result: AttemptResult,
  attempt: number,
  limits: RetryLimits,
): RetryStep {
  return match(result)
    .with({ kind: 'stored' }, (stored) => ({
      kind: 'answer' as const,
      answer: { ok: true as const, value: stored.stored },
    }))
    .with({ kind: 'refused' }, (refused) => ({
      kind: 'answer' as const,
      answer: { ok: false as const, failure: refused.failure },
    }))
    .with({ kind: 'again' }, (again): RetryStep => {
      if (attempt >= limits.maxAttempts) {
        return {
          kind: 'answer',
          answer: { ok: false, failure: { kind: 'not-stored', attempts: attempt } },
        };
      }

      return {
        kind: 'retry',
        pendingTail: again.pendingTail,
        delayMs: limits.retryDelayMs * attempt,
      };
    })
    .exhaustive();
}
