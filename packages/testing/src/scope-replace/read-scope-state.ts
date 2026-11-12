import type { ConsumerDeclaration, EntityID } from '@pepys/kit';
import { readLinkRows } from '../links/read-link-rows.ts';
import { readTableRows } from '../rows/read-table-rows.ts';
import type { StoreDatabase } from '../store-database/types.ts';
import type { Row } from '../utils/types.ts';
import { buildLinkKey } from './build-link-key.ts';
import { buildRowID } from './build-row-id.ts';
import type { ScopeResult, ScopeState, StoredLink } from './types.ts';

export async function readScopeState(
  db: StoreDatabase,
  consumer: ConsumerDeclaration,
  scope: EntityID,
  result: ScopeResult,
): Promise<ScopeState> {
  const owned = await db
    .selectFrom('scope_row')
    .select(['table_name', 'key', 'scope'])
    .where('consumer', '=', consumer.name)
    .execute();

  const rowOwners = new Map(owned.map((row) => [buildRowID(row.table_name, row.key), row.scope]));

  const wanted = [
    ...result.rows.map((row) => ({ table: row.table, key: row.key })),
    ...owned
      .filter((row) => row.scope === scope)
      .map((row) => ({ table: row.table_name, key: row.key })),
  ];

  const storedRows = new Map<string, Row>();

  for (const row of wanted) {
    const declaration = consumer.tables[row.table];

    const [stored] =
      declaration === undefined ? [] : await readTableRows(db, row.table, declaration, row.key);

    if (stored !== undefined) {
      storedRows.set(buildRowID(row.table, row.key), stored);
    }
  }

  const links = await readLinkRows(db, consumer.name);

  const storedLinks = new Map<string, StoredLink>(
    links.map((row) => {
      const link = {
        type: row.type,
        from: row.from_id,
        to: row.to_id,
        confidence: row.confidence,
        evidence: row.evidence,
      };

      return [buildLinkKey(link), { scope: row.scope, link }];
    }),
  );

  return { rowOwners, storedRows, storedLinks };
}
