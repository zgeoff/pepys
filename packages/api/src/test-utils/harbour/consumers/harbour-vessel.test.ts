import { expect, test } from 'bun:test';
import { applyFact } from './harbour-vessel.ts';

test('it upserts one vessel row named by the fact, at the fact time, and the name as an alias', () => {
  const operations: unknown = JSON.parse(
    applyFact(
      JSON.stringify({
        id: 'event:harbour:evt-31',
        entity: 'harbour:vessel:4',
        at: '2026-11-03T07:30:00.000Z',
        payload: { name: 'Gannet' },
      }),
    ),
  );

  expect(operations).toStrictEqual([
    {
      upsert: {
        harbour_vessel: {
          id: 'harbour:vessel:4',
          name: 'Gannet',
          updated_at: '2026-11-03T07:30:00.000Z',
        },
      },
    },
    {
      upsert: {
        harbour_vessel_alias: {
          alias: 'gannet',
          entity_id: 'harbour:vessel:4',
          updated_at: '2026-11-03T07:30:00.000Z',
        },
      },
    },
  ]);
});

test.each([
  [
    'a fact with no name',
    { entity: 'harbour:vessel:4', at: '2026-11-03T07:30:00.000Z', payload: {} },
  ],
  ['a fact with no time', { entity: 'harbour:vessel:4', payload: { name: 'Gannet' } }],
  ['a fact with no entity', { at: '2026-11-03T07:30:00.000Z', payload: { name: 'Gannet' } }],
])('it throws for %s', (_label, fact) => {
  const applying = () => applyFact(JSON.stringify(fact));

  expect(applying).toThrowWithMessage(Error, 'the fact is no vessel fact');
});
