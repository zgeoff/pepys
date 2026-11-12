import { expect, test } from 'bun:test';
import type { EntityID, FactID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { collectDirtyScopes } from './collect-dirty-scopes.ts';

test.each<[string, string[], string[]]>([
  ['the batch is empty', [], []],
  ['no fact has the scope kind', ['harbour:berth:north'], []],
  [
    'facts of several entities have the scope kind',
    ['harbour:vessel:tern', 'harbour:vessel:auk'],
    ['harbour:vessel:auk', 'harbour:vessel:tern'],
  ],
  [
    'two facts have the same entity',
    ['harbour:vessel:tern', 'harbour:vessel:tern'],
    ['harbour:vessel:tern'],
  ],
  [
    'facts of the scope kind and another kind are mixed',
    ['harbour:berth:north', 'harbour:vessel:tern'],
    ['harbour:vessel:tern'],
  ],
  ['an entity ID does not parse', ['vessel-tern'], []],
  [
    'an ID holds a character outside the basic plane',
    ['harbour:vessel:\u{1F6A2}', 'harbour:vessel:\u{FF5E}'],
    ['harbour:vessel:\u{FF5E}', 'harbour:vessel:\u{1F6A2}'],
  ],
])('it collects the dirty scopes when %s', (_title, entities, scopes) => {
  const facts = entities.map((entity, index) => ({
    stream: 'facts.harbour.vessel',
    seqNum: index,
    envelope: {
      id: toTagged<FactID>(`event:harbour:${index}`),
      type: 'vessel.docked',
      v: 1 as const,
      api: 'pepys/1',
      entity: toTagged<EntityID>(entity),
      at: '2026-10-01T08:00:00Z',
      payload: {},
    },
  }));

  const collected = collectDirtyScopes(facts, 'harbour:vessel');

  expect(collected).toStrictEqual(scopes.map((scope) => toTagged<EntityID>(scope)));
});
