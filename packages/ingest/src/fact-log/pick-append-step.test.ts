import { expect, test } from 'bun:test';
import type { EntityID, FactID, StreamOffset } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import type { StoredFact } from './fact-log.ts';
import type { AppendStep } from './pick-append-step.ts';
import { pickAppendStep } from './pick-append-step.ts';

test.each<
  [
    string,
    { ok: true; value: StreamOffset } | { ok: false; failure: { reason: 'unknown-stream' } },
    string[],
    AppendStep,
  ]
>([
  [
    'a refusal for a stream the log lacks',
    { ok: false, failure: { reason: 'unknown-stream' } },
    [],
    { kind: 'refused', reason: 'unknown-stream' },
  ],
  [
    'an append at the tail when no fact was read',
    { ok: true, value: toTagged<StreamOffset>(4) },
    [],
    { kind: 'append', expectedTail: toTagged<StreamOffset>(4) },
  ],
  [
    'an append at the tail when the facts read lack the fact ID',
    { ok: true, value: toTagged<StreamOffset>(4) },
    ['webhook:github:d-8', 'webhook:github:d-9'],
    { kind: 'append', expectedTail: toTagged<StreamOffset>(4) },
  ],
  [
    'the offset of the fact ID among the facts read',
    { ok: true, value: toTagged<StreamOffset>(4) },
    ['webhook:github:d-8', 'webhook:github:d-1'],
    { kind: 'found', offset: toTagged<StreamOffset>(3) },
  ],
])('it picks %s', (_title, tail, storedIDs, step) => {
  const storedFacts = storedIDs.map((id, index): StoredFact => ({
    offset: toTagged<StreamOffset>(2 + index),
    fact: {
      id: toTagged<FactID>(id),
      type: 'github.pull_request.opened',
      v: 1,
      api: 'github/2022-11-28',
      entity: toTagged<EntityID>('github:pr:77'),
      at: '2026-10-02T10:30:00Z',
      payload: {},
    },
    body: '{}',
    appendedAtMs: 0,
  }));

  expect(pickAppendStep(toTagged<FactID>('webhook:github:d-1'), tail, storedFacts)).toStrictEqual(
    step,
  );
});
