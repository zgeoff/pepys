import { expect, test } from 'bun:test';
import type { StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import type { AppendBatchOutcome } from './fact-log.ts';
import { pickAttemptStep } from './pick-attempt-step.ts';
import type { AttemptStep } from './pick-attempt-step.ts';

test.each<[string, AppendBatchOutcome, StreamOffset | null, AttemptStep]>([
  [
    'an acknowledged append',
    { kind: 'acknowledged', firstOffset: toTagged<StreamOffset>(4), count: 2 },
    null,
    { kind: 'stored', stored: { firstOffset: toTagged<StreamOffset>(4), count: 2 } },
  ],
  [
    'a tail mismatch with no attempt open',
    { kind: 'rejected', reason: 'tail-mismatch' },
    null,
    { kind: 'again', pendingTail: null },
  ],
  [
    'a tail mismatch with an attempt open',
    { kind: 'rejected', reason: 'tail-mismatch' },
    toTagged<StreamOffset>(4),
    { kind: 'settle', tail: toTagged<StreamOffset>(4) },
  ],
  [
    'an unknown outcome with no attempt open',
    { kind: 'unknown' },
    null,
    { kind: 'settle', tail: toTagged<StreamOffset>(4) },
  ],
  [
    'an unknown outcome with an attempt open',
    { kind: 'unknown' },
    toTagged<StreamOffset>(4),
    { kind: 'settle', tail: toTagged<StreamOffset>(4) },
  ],
  [
    'an unknown-stream rejection',
    { kind: 'rejected', reason: 'unknown-stream' },
    null,
    { kind: 'refused', failure: { kind: 'refused', reason: 'unknown-stream' } },
  ],
  [
    'a too-large rejection',
    { kind: 'rejected', reason: 'too-large' },
    toTagged<StreamOffset>(4),
    { kind: 'refused', failure: { kind: 'refused', reason: 'too-large' } },
  ],
  [
    'an invalid-envelope rejection',
    { kind: 'rejected', reason: 'invalid-envelope', index: 1 },
    null,
    { kind: 'refused', failure: { kind: 'refused', reason: 'invalid-envelope' } },
  ],
])('it picks the step after %s', (_title, outcome, pendingTail, step) => {
  const picked = pickAttemptStep(outcome, toTagged<StreamOffset>(4), pendingTail);

  expect(picked).toStrictEqual(step);
});
