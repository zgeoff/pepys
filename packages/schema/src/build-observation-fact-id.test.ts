import { expect, test } from 'bun:test';
import { toTagged } from '@zgeoff/std';
import { buildObservationFactID } from './build-observation-fact-id.ts';
import { parseEntityID } from './parse-entity-id.ts';
import type { EntityID } from './types.ts';

test('it starts an observation fact ID with its kind and a sha256 hex digest', () => {
  const factID = buildObservationFactID({
    source: 'gmail',
    entity: toTagged<EntityID>('gmail:label:inbox'),
    sourceUpdateTime: '2026-10-24T01:02:03Z',
  });

  expect(factID).toMatch(/^observation:[0-9a-f]{64}$/u);
});

test('it gives the same ID for the same inputs', () => {
  const parts = {
    source: 'gmail',
    entity: toTagged<EntityID>('gmail:label:inbox'),
    sourceUpdateTime: '2026-10-24T01:02:03Z',
  };

  expect(buildObservationFactID(parts)).toStrictEqual(buildObservationFactID(parts));
});

test('it gives another ID for another source update time', () => {
  const entity = toTagged<EntityID>('gmail:label:inbox');

  expect(
    buildObservationFactID({ source: 'gmail', entity, sourceUpdateTime: '2026-10-24T01:02:03Z' }),
  ).not.toBe(
    buildObservationFactID({ source: 'gmail', entity, sourceUpdateTime: '2026-10-24T01:02:04Z' }),
  );
});

test('it does not let a field move its boundary into the next field', () => {
  const entity = toTagged<EntityID>('gmail:label:inbox');

  expect(buildObservationFactID({ source: 'gm', entity, sourceUpdateTime: 'ail' })).not.toBe(
    buildObservationFactID({ source: 'gma', entity, sourceUpdateTime: 'il' }),
  );
});

test('it gives an ID that is not an entity ID', () => {
  const factID = buildObservationFactID({
    source: 'gmail',
    entity: toTagged<EntityID>('gmail:label:inbox'),
    sourceUpdateTime: '2026-10-24T01:02:03Z',
  });

  expect(parseEntityID(factID).ok).toBe(false);
});
