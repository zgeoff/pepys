import { checkDeployment } from '@pepys/kit';
import type { Plugin, TableDeclaration } from '@pepys/kit';
import { buildFactIndex } from '../fact-index/build-fact-index.ts';
import type { FactIndex } from '../fact-index/types.ts';
import { readLinkRows } from '../links/read-link-rows.ts';
import { createMemoryStoreReader } from '../memory-store-reader/create-memory-store-reader.ts';
import { readTableRows } from '../rows/read-table-rows.ts';
import { writeRow } from '../rows/write-row.ts';
import { createStoreDatabase } from '../store-database/create-store-database.ts';
import { ApplyError } from '../utils/apply-error.ts';
import { parseAppliedFacts } from './parse-applied-facts.ts';
import { runConsumers } from './run-consumers.ts';
import type { AppliedFactIDs } from './run-consumers.ts';
import { storeHooks } from './store-hooks.ts';
import type { StoreHooks } from './store-hooks.ts';
import type { TestStore } from './types.ts';

interface TestStoreOptions {
  plugins: readonly Plugin[];
}

// A store for `bun test`: every consumer of the plug-ins runs its TypeScript entry over one
// in-memory database. It repeats the host's envelope check, link check and scope replace, and
// proves neither the scriptc compile nor the Rust host.
export async function createTestStore(options: TestStoreOptions): Promise<TestStore> {
  const checked = checkDeployment({ name: 'test-store', plugins: options.plugins });

  if (!checked.ok) {
    throw new Error(`the deployment is invalid: ${JSON.stringify(checked.failure)}`);
  }

  const deployment = checked.value;

  const store = await createStoreDatabase(deployment.consumers);

  const db = store.db;
  const reader = createMemoryStoreReader(store.database, deployment);
  let index: FactIndex = { log: [], firstCopies: new Map() };

  let applied: AppliedFactIDs = new Map();

  const getTable = (name: string): TableDeclaration => {
    const table = deployment.consumers.find((consumer) => Object.hasOwn(consumer.tables, name))
      ?.tables[name];

    if (table === undefined) {
      throw new Error(`no consumer of the deployment has the table ${name}`);
    }

    return table;
  };

  const applyInTurn = async (records: Parameters<StoreHooks['applyEnvelopes']>[0]) => {
    const next = buildFactIndex(index, records);

    applied = await db
      .transaction()
      .execute((transaction) =>
        runConsumers(transaction, deployment.consumers, { ...next, applied }),
      );

    index = next.index;
  };

  // Each apply builds on the index and applied IDs that the one before it left, so two applies
  // that run at once take turns. A refused apply rejects for its caller only.
  let lastApply: Promise<void> = Promise.resolve();

  const applyEnvelopes: StoreHooks['applyEnvelopes'] = async (records) => {
    const before = lastApply;
    const turn = Promise.withResolvers<void>();

    lastApply = turn.promise;

    try {
      await before;
      await applyInTurn(records);
    } finally {
      turn.resolve();
    }
  };

  const testStore: TestStore = {
    writeRows: async (_consumer, table, rows) => {
      for (const row of rows) {
        await writeRow(db, table, getTable(table), row);
      }
    },
    apply: async (source, facts, applyOptions) => {
      const envelopes = parseAppliedFacts(source, facts, applyOptions?.sender);

      if (!envelopes.ok) {
        throw new ApplyError(envelopes.failure);
      }

      await applyEnvelopes(envelopes.value);
    },
    query: async (query, input) => {
      const parsed = query.input.parse(input);

      const result = await reader.withConsumers(query.reads, (queryDB) =>
        query.handler({ input: parsed, db: queryDB }),
      );

      if (!result.ok) {
        throw new Error(
          `the query ${query.name} reads consumers with no current version: ${result.failure.consumers.join(', ')}`,
        );
      }

      return query.output.parse(result.value);
    },
    readLinks: () => readLinkRows(db),
    readRows: (table) => readTableRows(db, table, getTable(table)),
    reader,
    [Symbol.asyncDispose]: () => db.destroy(),
  };

  storeHooks.set(testStore, { applyEnvelopes, nextOffsets: new Map() });

  return testStore;
}
