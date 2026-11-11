import { expect, expectTypeOf, test } from 'bun:test';
import { z } from 'zod';
import { defineLinkType } from '../link-types/define-link-type.ts';
import { defineQuery } from '../queries/define-query.ts';
import { defineFactFamily } from '../sources/define-fact-family.ts';
import { defineSource } from '../sources/define-source.ts';
import { defineTable } from '../tables/define-table.ts';
import { buildStubConsumer } from '../test-utils/build-stub-consumer.ts';
import { definePlugin } from './define-plugin.ts';
import type { Plugin, PluginClient } from './types.ts';

test('it fills the parts a plug-in leaves out', () => {
  expect(definePlugin({ name: 'ledger' })).toStrictEqual({
    kit: 1,
    name: 'ledger',
    settings: undefined,
    sources: [],
    consumers: [],
    queries: [],
    linkTypes: [],
    entityKinds: [],
  });
});

test('it takes the link types from the consumers, once per name', () => {
  const servedBy = defineLinkType({
    name: 'served_by',
    from: ['ledger:till'],
    to: ['roster:clerk'],
    hub: false,
  });

  const plugin = definePlugin({
    name: 'ledger',
    consumers: [
      buildStubConsumer({ name: 'ledger_till', links: [servedBy] }),
      buildStubConsumer({ name: 'ledger_shift', links: [servedBy] }),
    ],
  });

  expect(plugin.linkTypes).toStrictEqual([servedBy]);
});

test('it takes the entity kinds from the families and the entity views, once each', () => {
  const tillTable = defineTable({
    columns: { id: { kind: 'entityID' } },
    primaryKey: ['id'],
    indexes: [],
  });

  const plugin = definePlugin({
    name: 'ledger',
    sources: [
      defineSource({
        name: 'ledger',
        families: [
          defineFactFamily({
            stream: 'facts.ledger.till',
            api: 'ledger/1',
            entityKind: 'ledger:till',
            types: {},
          }),
        ],
      }),
    ],
    consumers: [
      buildStubConsumer({
        name: 'ledger_till',
        tables: { till: tillTable, drawer: tillTable },
        entityViews: [
          {
            table: 'till',
            kind: 'ledger:till',
            id: 'id',
            title: 'id',
            url: null,
            actor: null,
            updatedAt: 'id',
          },
          {
            table: 'drawer',
            kind: 'ledger:drawer',
            id: 'id',
            title: 'id',
            url: null,
            actor: null,
            updatedAt: 'id',
          },
        ],
      }),
    ],
  });

  expect(plugin.entityKinds).toStrictEqual(['ledger:till', 'ledger:drawer']);
});

test('it types a call of each query of a plug-in by its name', () => {
  const input = z.object({ day: z.string(), till: z.string().optional() });
  const output = z.object({ cents: z.number() });

  const plugin = definePlugin({
    name: 'ledger',
    queries: [
      defineQuery({
        name: 'ledger_takings',
        description: 'Sums the takings of a day.',
        input,
        output,
        reads: [],
        handler: () => Promise.resolve({ cents: 0 }),
      }),
    ],
  });

  expectTypeOf<PluginClient<typeof plugin>>().toEqualTypeOf<{
    ledger_takings: (input: TakingsInput) => Promise<{ cents: number }>;
  }>();
});

test('it types no call for a plug-in with no queries whose query type is the widest one', () => {
  const plugin: Plugin = definePlugin({ name: 'lighthouse' });

  expectTypeOf<PluginClient<typeof plugin>>().toEqualTypeOf<Record<never, never>>();
});

interface TakingsInput {
  day: string;
  till?: string | undefined;
}
