import type { TableDeclaration } from '@pepys/kit';
import { sql } from 'kysely';
import type { QueryExecutorProvider } from 'kysely';
import { buildKeyFilter } from './build-key-filter.ts';

export async function removeRow(
  db: QueryExecutorProvider,
  name: string,
  table: TableDeclaration,
  key: string,
): Promise<void> {
  await sql`delete from ${sql.table(name)} where ${buildKeyFilter(table, key)}`.execute(db);
}
