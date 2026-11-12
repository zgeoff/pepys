import { expect, onTestFinished, test } from 'bun:test';
import { defineConsumer, defineTable } from '@pepys/kit';
import { readTableRows } from '../../rows/read-table-rows.ts';
import { createStoreDatabase } from '../../store-database/create-store-database.ts';
import { runCaseBatch } from './run-case-batch.ts';

async function setupTest() {
  const consumer = defineConsumer({
    name: 'pier_berth',
    entry: new URL('file:///run-case-batch/entry.ts'),
    input: { mode: 'scope', scopeKind: 'pier:berth', streams: ['facts.pier.berth'] },
    tables: {
      pier_berth: defineTable({
        columns: { id: { kind: 'entityID' }, label: { kind: 'text' } },
        primaryKey: ['id'],
        indexes: [],
      }),
    },
    entityViews: [],
    reads: [],
    links: [],
  });

  const store = await createStoreDatabase([consumer]);

  onTestFinished(() => store.db.destroy());

  return {
    database: store.database,
    runBatch: (scopes: readonly { scope: string; output: string }[]) =>
      runCaseBatch(store.db, consumer, scopes),
    readBerths: () => readTableRows(store.db, 'pier_berth', consumer.tables.pier_berth),
  };
}

test('it gives the change entries of each scope of the batch, in the order of the scopes', async () => {
  const ctx = await setupTest();

  const outcome = await ctx.runBatch([
    {
      scope: 'pier:berth:b',
      output: JSON.stringify([{ upsert: { pier_berth: { id: 'pier:berth:b', label: 'Bravo' } } }]),
    },
    {
      scope: 'pier:berth:a',
      output: JSON.stringify([{ upsert: { pier_berth: { id: 'pier:berth:a', label: 'Alfa' } } }]),
    },
  ]);

  expect(outcome).toStrictEqual({
    changes: [
      {
        type: 'pier_berth',
        key: '["pier:berth:b"]',
        value: { id: 'pier:berth:b', label: 'Bravo' },
        headers: { operation: 'insert' },
      },
      {
        type: 'pier_berth',
        key: '["pier:berth:a"]',
        value: { id: 'pier:berth:a', label: 'Alfa' },
        headers: { operation: 'insert' },
      },
    ],
  });
});

test('it keeps the rows of each scope of a batch that succeeds', async () => {
  const ctx = await setupTest();

  await ctx.runBatch([
    {
      scope: 'pier:berth:b',
      output: JSON.stringify([{ upsert: { pier_berth: { id: 'pier:berth:b', label: 'Bravo' } } }]),
    },
    {
      scope: 'pier:berth:a',
      output: JSON.stringify([{ upsert: { pier_berth: { id: 'pier:berth:a', label: 'Alfa' } } }]),
    },
  ]);

  const berths = await ctx.readBerths();

  expect(berths).toStrictEqual([
    { id: 'pier:berth:a', label: 'Alfa' },
    { id: 'pier:berth:b', label: 'Bravo' },
  ]);
});

test('it names the kind of a refusal, and the scopes before it in the batch write nothing', async () => {
  const ctx = await setupTest();

  const outcome = await ctx.runBatch([
    {
      scope: 'pier:berth:a',
      output: JSON.stringify([{ upsert: { pier_berth: { id: 'pier:berth:a', label: 'Alfa' } } }]),
    },
    {
      scope: 'pier:berth:b',
      output: JSON.stringify([{ upsert: { pier_crane: { id: 'pier:crane:1' } } }]),
    },
  ]);

  const berths = await ctx.readBerths();

  expect({ outcome, berths }).toStrictEqual({ outcome: { refused: 'not-owned' }, berths: [] });
});

test('it throws an error that is no refusal', async () => {
  const ctx = await setupTest();

  await ctx.database.exec('DROP TABLE pier_berth');

  const running = ctx.runBatch([
    {
      scope: 'pier:berth:a',
      output: JSON.stringify([{ upsert: { pier_berth: { id: 'pier:berth:a', label: 'Alfa' } } }]),
    },
  ]);

  expect(running).rejects.toThrowWithMessage(Error, /no such table/u);
});
