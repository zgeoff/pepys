import { expect, test } from 'bun:test';
import { defineConsumer, defineTable } from '@pepys/kit';
import { buildModuleSymbols } from './build-module-symbols.ts';

test('it gives a fact consumer one row read per read table', () => {
  const consumer = defineConsumer({
    name: 'tide_log',
    entry: new URL('file:///stub/consumers/tide-log.ts'),
    input: { mode: 'fact', streams: ['facts.harbour.tide'] },
    tables: {
      tide_reading: defineTable({
        columns: { id: { kind: 'entityID' } },
        primaryKey: ['id'],
        indexes: [],
      }),
    },
    entityViews: [],
    reads: ['tide_reading'],
    links: [],
  });

  expect(buildModuleSymbols(consumer)).toStrictEqual({
    entryExport: 'applyFact',
    exports: { init: 'tide_log_init', apply: 'tide_log_apply_fact' },
    imports: [
      {
        kind: 'row',
        table: 'tide_reading',
        length: 'readTideReadingLength',
        into: 'readTideReadingInto',
      },
    ],
  });
});

test('it gives a scope consumer the one scope read', () => {
  const consumer = defineConsumer({
    name: 'berth_plan',
    entry: new URL('file:///stub/consumers/berth-plan.ts'),
    input: { mode: 'scope', scopeKind: 'harbour:berth', streams: ['facts.harbour.berth'] },
    tables: {},
    entityViews: [],
    reads: [],
    links: [],
  });

  expect(buildModuleSymbols(consumer)).toStrictEqual({
    entryExport: 'applyScope',
    exports: { init: 'berth_plan_init', apply: 'berth_plan_apply_scope' },
    imports: [{ kind: 'scope_facts', length: 'readScopeFactsLength', into: 'readScopeFactsInto' }],
  });
});
