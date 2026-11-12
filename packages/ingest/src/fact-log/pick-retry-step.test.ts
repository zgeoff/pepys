import { expect, test } from 'bun:test';
import type { StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import type { AttemptResult } from './pick-attempt-step.ts';
import { pickRetryStep } from './pick-retry-step.ts';
import type { RetryStep } from './pick-retry-step.ts';

test.each<[string, AttemptResult, number, RetryStep]>([
  [
    'a stored run',
    { kind: 'stored', stored: { firstOffset: toTagged<StreamOffset>(2), count: 3 } },
    1,
    {
      kind: 'answer',
      answer: { ok: true, value: { firstOffset: toTagged<StreamOffset>(2), count: 3 } },
    },
  ],
  [
    'a refusal on the first attempt',
    { kind: 'refused', failure: { kind: 'refused', reason: 'too-large' } },
    1,
    { kind: 'answer', answer: { ok: false, failure: { kind: 'refused', reason: 'too-large' } } },
  ],
  [
    'a refusal on the last attempt',
    { kind: 'refused', failure: { kind: 'refused', reason: 'unknown-stream' } },
    3,
    {
      kind: 'answer',
      answer: { ok: false, failure: { kind: 'refused', reason: 'unknown-stream' } },
    },
  ],
  [
    'an open attempt with attempts left',
    { kind: 'again', pendingTail: toTagged<StreamOffset>(5) },
    1,
    { kind: 'retry', pendingTail: toTagged<StreamOffset>(5), delayMs: 200 },
  ],
  [
    'a closed attempt with attempts left',
    { kind: 'again', pendingTail: null },
    2,
    { kind: 'retry', pendingTail: null, delayMs: 400 },
  ],
  [
    'an open attempt on the last attempt',
    { kind: 'again', pendingTail: toTagged<StreamOffset>(5) },
    3,
    { kind: 'answer', answer: { ok: false, failure: { kind: 'not-stored', attempts: 3 } } },
  ],
])('it picks the step after %s', (_title, result, attempt, step) => {
  const picked = pickRetryStep(result, attempt, { maxAttempts: 3, retryDelayMs: 200 });

  expect(picked).toStrictEqual(step);
});
