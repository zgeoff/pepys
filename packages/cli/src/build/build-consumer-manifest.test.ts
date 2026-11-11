import { expect, test } from 'bun:test';
import { defineConsumer, defineLinkType, defineTable } from '@pepys/kit';
import { generateSqliteSchema } from '@pepys/kit/generators';
import { buildConsumerManifest } from './build-consumer-manifest.ts';

test('it copies the input, the tables and the link types of a scope consumer', () => {
  const consumer = defineConsumer({
    name: 'berth_plan',
    entry: new URL('file:///stub/consumers/berth-plan.ts'),
    input: { mode: 'scope', scopeKind: 'harbour:berth', streams: ['facts.harbour.berth'] },
    tables: {
      berth_booking: defineTable({
        columns: {
          berth_id: { kind: 'entityID' },
          ship_id: { kind: 'entityID' },
          note: { kind: 'text', nullable: true },
        },
        primaryKey: ['berth_id', 'ship_id'],
        indexes: [{ columns: ['ship_id'] }],
      }),
    },
    entityViews: [],
    reads: [],
    links: [
      defineLinkType({
        name: 'moored_at',
        from: ['harbour:ship'],
        to: ['harbour:berth'],
        hub: false,
      }),
    ],
  });

  expect(buildConsumerManifest(consumer)).toStrictEqual({
    name: 'berth_plan',
    input: { mode: 'scope', scopeKind: 'harbour:berth', streams: ['facts.harbour.berth'] },
    exports: { init: 'berth_plan_init', apply: 'berth_plan_apply_scope' },
    imports: [{ kind: 'scope_facts', length: 'readScopeFactsLength', into: 'readScopeFactsInto' }],
    tables: {
      berth_booking: {
        columns: {
          berth_id: { kind: 'entityID', nullable: false },
          ship_id: { kind: 'entityID', nullable: false },
          note: { kind: 'text', nullable: true },
        },
        primaryKey: ['berth_id', 'ship_id'],
        indexes: [['ship_id']],
      },
    },
    links: [{ name: 'moored_at', from: ['harbour:ship'], to: ['harbour:berth'], hub: false }],
    schema: generateSqliteSchema(consumer),
  });
});
