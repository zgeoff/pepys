import { expect, test } from 'bun:test';
import type { FactID, Result, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import type { StoredFact } from './fact-log.ts';
import type { AttemptResult } from './pick-attempt-step.ts';
import { pickSettledAttempt } from './pick-settled-attempt.ts';
import { buildTestFact } from './test-utils/build-test-fact.ts';
import { buildTestStoredFact } from './test-utils/build-test-stored-fact.ts';

test.each<
  [string, Result<readonly StoredFact[], { reason: 'unknown-stream' }> | null, AttemptResult]
>([
  ['the read failed', null, { kind: 'again', pendingTail: toTagged<StreamOffset>(7) }],
  [
    'the stream is unknown',
    { ok: false, failure: { reason: 'unknown-stream' } },
    { kind: 'refused', failure: { kind: 'refused', reason: 'unknown-stream' } },
  ],
  [
    'the whole run is at the offsets',
    {
      ok: true,
      value: [
        buildTestStoredFact(buildTestFact('event:x:1'), 7),
        buildTestStoredFact(buildTestFact('event:x:2'), 8),
      ],
    },
    { kind: 'stored', stored: { firstOffset: toTagged<StreamOffset>(7), count: 2 } },
  ],
  [
    'nothing is at the offsets yet',
    { ok: true, value: [] },
    { kind: 'again', pendingTail: toTagged<StreamOffset>(7) },
  ],
  [
    'another writer took the offsets',
    { ok: true, value: [buildTestStoredFact(buildTestFact('event:x:9'), 7)] },
    { kind: 'again', pendingTail: null },
  ],
])('it picks the result of a settle read when %s', (_title, stored, result) => {
  const ids = [toTagged<FactID>('event:x:1'), toTagged<FactID>('event:x:2')];
  const picked = pickSettledAttempt(stored, ids, toTagged<StreamOffset>(7));

  expect(picked).toStrictEqual(result);
});
