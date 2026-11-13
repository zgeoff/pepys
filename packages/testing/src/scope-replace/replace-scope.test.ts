import { expect, onTestFinished, test } from 'bun:test';
import type { EntityID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { readLinkRows } from '../links/read-link-rows.ts';
import { writeLink } from '../links/write-link.ts';
import { readTableRows } from '../rows/read-table-rows.ts';
import { createStoreDatabase } from '../store-database/create-store-database.ts';
import { buildCaseConsumer } from '../test-utils/scope-replace/build-case-consumer.ts';
import { runCaseBatch } from '../test-utils/scope-replace/run-case-batch.ts';
import replaceCases from './scope-replace-cases.json' with { type: 'json' };

async function setupTest() {
  const consumer = buildCaseConsumer(replaceCases.consumer);

  const store = await createStoreDatabase([consumer]);

  onTestFinished(() => store.db.destroy());

  return {
    writeStoredLink: (row: (typeof replaceCases.cases)[number]['links'][number]) => {
      const scope = row.scope === null ? null : toTagged<EntityID>(row.scope);

      return writeLink(store.db, row.origin, scope, {
        type: row.type,
        from: row.from_id,
        to: row.to_id,
        confidence: row.confidence,
        evidence: row.evidence,
      });
    },
    runBatch: (scopes: readonly { scope: string; output: string }[]) =>
      runCaseBatch(store.db, consumer, scopes),
    readRows: async () => {
      const tables = Object.entries(consumer.tables);

      const rows = await Promise.all(
        tables.map(([name, table]) => readTableRows(store.db, name, table)),
      );

      return Object.fromEntries(tables.map(([name], index) => [name, rows[index]]));
    },
    readLinks: () => readLinkRows(store.db),
  };
}

// The host's Rust scope replace runs the same cases, so the two replaces cannot drift apart unseen.
test.each(
  replaceCases.cases
    .filter((replaceCase) => replaceCase.stored === undefined)
    .map((replaceCase) => [replaceCase.title, replaceCase] as const),
)('#replaceScope in the shared case where %s', async (_title, replaceCase) => {
  const ctx = await setupTest();

  const outcomes = [];

  for (const batch of replaceCase.batches) {
    const outcome = await ctx.runBatch(batch.scopes);

    outcomes.push(outcome);
  }

  const rows = await ctx.readRows();
  const links = await ctx.readLinks();

  // the case file's rows and change entries are plain JSON, with no row type
  const received: unknown = { outcomes, rows, links };

  expect(received).toStrictEqual({
    outcomes: replaceCase.batches.map((batch) => {
      const { scopes: _scopes, ...outcome } = batch;

      return outcome;
    }),
    rows: replaceCase.rows,
    links: replaceCase.links,
  });
});

test.each(
  replaceCases.cases
    .filter((replaceCase) => replaceCase.stored !== undefined)
    .map((replaceCase) => [replaceCase.title, replaceCase] as const),
)('#replaceScope over stored links in the shared case where %s', async (_title, replaceCase) => {
  const ctx = await setupTest();

  for (const link of replaceCase.stored.links) {
    await ctx.writeStoredLink(link);
  }

  const outcomes = [];

  for (const batch of replaceCase.batches) {
    const outcome = await ctx.runBatch(batch.scopes);

    outcomes.push(outcome);
  }

  const rows = await ctx.readRows();
  const links = await ctx.readLinks();

  // the case file's rows and change entries are plain JSON, with no row type
  const received: unknown = { outcomes, rows, links };

  expect(received).toStrictEqual({
    outcomes: replaceCase.batches.map((batch) => {
      const { scopes: _scopes, ...outcome } = batch;

      return outcome;
    }),
    rows: replaceCase.rows,
    links: replaceCase.links,
  });
});
