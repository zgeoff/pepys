import type { TableDeclaration } from '@pepys/kit';
import { sql } from 'kysely';
import type { QueryExecutorProvider } from 'kysely';
import type { Row } from '../utils/types.ts';
import { buildKeyFilter } from './build-key-filter.ts';
import { toRowValue } from './to-row-value.ts';

// Every row of a table in primary key order, or with `key` the one row of that key, as the module
// wrote it.
export async function readTableRows(
  db: QueryExecutorProvider,
  name: string,
  table: TableDeclaration,
  key?: string,
): Promise<Row[]> {
  const order = sql.join(table.primaryKey.map((column) => sql.ref(column)));
  const filter = key === undefined ? sql`1` : buildKeyFilter(table, key);

  const stored =
    await sql`select * from ${sql.table(name)} where ${filter} order by ${order}`.execute(db);

  return stored.rows.map((row) =>
    Object.fromEntries(
      Object.entries(table.columns).map(([column, declaration]) => {
        const value = isRecord(row) ? row[column] : undefined;

        return [column, toRowValue(declaration, value)];
      }),
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
