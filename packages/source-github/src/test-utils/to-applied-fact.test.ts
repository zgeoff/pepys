import { expect, test } from 'bun:test';
import type { EntityID, FactID, StreamName } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { toAppliedFact } from './to-applied-fact.ts';

test('it keeps the delivery of a webhook fact ID as the event', () => {
  const applied = toAppliedFact({
    stream: toTagged<StreamName>('facts.github.release'),
    fact: {
      id: toTagged<FactID>('webhook:github:d-41'),
      type: 'github.release.published',
      v: 1,
      api: 'github/2022-11-28',
      entity: toTagged<EntityID>('github:release:6'),
      at: '2026-10-03T07:00:00Z',
      payload: { action: 'published', release: { id: 6 } },
    },
    blobs: [],
  });

  expect(applied).toStrictEqual({
    type: 'github.release.published',
    event: 'd-41',
    entity: 'github:release:6',
    at: '2026-10-03T07:00:00Z',
    payload: { action: 'published', release: { id: 6 } },
  });
});

test('it turns the first colon of another fact ID into a dash, and keeps the actor', () => {
  const applied = toAppliedFact({
    stream: toTagged<StreamName>('facts.github.release'),
    fact: {
      id: toTagged<FactID>('resync:github:release:6:2026-10-03'),
      type: 'github.release.resynced',
      v: 1,
      api: 'github/2022-11-28',
      entity: toTagged<EntityID>('github:release:6'),
      actor: toTagged<EntityID>('github:user:77'),
      at: '2026-10-03T07:00:00Z',
      payload: { action: 'resynced', release: { id: 6 } },
    },
    blobs: [],
  });

  expect(applied).toStrictEqual({
    type: 'github.release.resynced',
    event: 'resync-github:release:6:2026-10-03',
    entity: 'github:release:6',
    actor: 'github:user:77',
    at: '2026-10-03T07:00:00Z',
    payload: { action: 'resynced', release: { id: 6 } },
  });
});

test.each([
  ['a type no GitHub family holds', 'github.wiki.edited', 'github:release:6'],
  ['an entity of another kind than its family', 'github.release.published', 'github:issue:6'],
])('it throws for a stored fact with %s', (_label, type, entity) => {
  const converting = () =>
    toAppliedFact({
      stream: toTagged<StreamName>('facts.github.release'),
      fact: {
        id: toTagged<FactID>('webhook:github:d-42'),
        type,
        v: 1,
        api: 'github/2022-11-28',
        entity: toTagged<EntityID>(entity),
        at: '2026-10-03T07:00:00Z',
        payload: { action: 'published', release: { id: 6 } },
      },
      blobs: [],
    });

  expect(converting).toThrowWithMessage(Error, /a stored fact has a type of the GitHub source/u);
});
