import { expect, test } from 'bun:test';
import type { EntityID, FactID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { collectNewFacts } from './collect-new-facts.ts';

test.each<[string, string[], string[], number[]]>([
  ['the batch is empty', [], ['event:harbour:a'], []],
  ['no fact was applied before', ['event:harbour:a', 'event:harbour:b'], [], [0, 1]],
  ['every fact was applied before', ['event:harbour:a'], ['event:harbour:a'], []],
  [
    'one fact of two was applied before',
    ['event:harbour:a', 'event:harbour:b'],
    ['event:harbour:a'],
    [1],
  ],
  ['the batch holds a fact twice', ['event:harbour:a', 'event:harbour:a'], [], [0]],
])('it collects the new facts when %s', (_title, ids, applied, kept) => {
  const facts = ids.map((id, index) => ({
    stream: 'facts.harbour.vessel',
    seqNum: index,
    envelope: {
      id: toTagged<FactID>(id),
      type: 'vessel.docked',
      v: 1 as const,
      api: 'pepys/1',
      entity: toTagged<EntityID>('harbour:vessel:tern'),
      at: '2026-10-01T08:00:00Z',
      payload: {},
    },
  }));

  const collected = collectNewFacts(facts, new Set(applied.map((id) => toTagged<FactID>(id))));

  expect(collected).toStrictEqual(facts.filter((_fact, index) => kept.includes(index)));
});
