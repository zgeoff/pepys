import type { LinkRow, Plugin, SourceDefinition } from '@pepys/kit';
import { createTestStore } from '../test-store/create-test-store.ts';
import type { AppliedFact } from '../test-store/types.ts';
import type { Row } from '../utils/types.ts';

export interface StoreSnapshot {
  rows: Readonly<Record<string, readonly Row[]>>;
  links: readonly LinkRow[];
}

export interface OrderReport {
  given: StoreSnapshot;
  reversed: StoreSnapshot;

  // the two snapshots are equal
  isSame: boolean;
}

interface OrderCheck<Source extends SourceDefinition> {
  plugins: readonly Plugin[];
  source: Source;
  facts: readonly AppliedFact<Source>[];
}

// One arrival order cannot show a missing tie-break. The reverse order puts every pair of facts the
// other way round, and the second pass applies them all again as one batch.
export async function applyInBothOrders<Source extends SourceDefinition>(
  check: OrderCheck<Source>,
): Promise<OrderReport> {
  const given = await readSnapshot(check, check.facts);
  const reversed = await readSnapshot(check, check.facts.toReversed());

  return { given, reversed, isSame: Bun.deepEquals(given, reversed, true) };
}

async function readSnapshot<Source extends SourceDefinition>(
  check: OrderCheck<Source>,
  facts: readonly AppliedFact<Source>[],
): Promise<StoreSnapshot> {
  await using store = await createTestStore({ plugins: check.plugins });

  for (const fact of facts) {
    await store.apply(check.source, [fact]);
  }

  await store.apply(check.source, facts);

  const tables = check.plugins
    .flatMap((plugin) => plugin.consumers)
    .flatMap((consumer) => Object.keys(consumer.tables));

  const rows: Record<string, readonly Row[]> = {};

  for (const table of tables) {
    rows[table] = await store.readRows(table);
  }

  return { rows, links: await store.readLinks() };
}
