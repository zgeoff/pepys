import { expect, test } from 'bun:test';
import { defineConsumer, defineTable } from '@pepys/kit';
import { buildEntityKindIndex } from './build-entity-kind-index.ts';

test('it maps the kind of each entity view to its consumer and view', () => {
  const vesselView = {
    table: 'harbour_vessel',
    kind: 'harbour:vessel',
    id: 'id',
    title: 'name',
    url: null,
    actor: null,
    updatedAt: 'updated_at',
  } as const;

  const berthView = { ...vesselView, table: 'harbour_berth', kind: 'harbour:berth' } as const;

  const consumer = defineConsumer({
    name: 'harbour_fleet',
    entry: new URL('file:///stub/harbour-fleet.ts'),
    input: { mode: 'fact', streams: ['facts.harbour.vessel'] },
    tables: {
      harbour_vessel: defineTable({
        columns: { id: { kind: 'entityID' }, name: { kind: 'text' }, updated_at: { kind: 'text' } },
        primaryKey: ['id'],
        indexes: [],
      }),
      harbour_berth: defineTable({
        columns: { id: { kind: 'entityID' }, name: { kind: 'text' }, updated_at: { kind: 'text' } },
        primaryKey: ['id'],
        indexes: [],
      }),
    },
    entityViews: [vesselView, berthView],
    reads: [],
    links: [],
  });

  expect(buildEntityKindIndex([consumer])).toStrictEqual(
    new Map([
      ['harbour:vessel', { consumer, view: vesselView }],
      ['harbour:berth', { consumer, view: berthView }],
    ]),
  );
});
