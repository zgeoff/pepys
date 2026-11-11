import type { TableDeclaration } from '@pepys/kit';
import { sql } from 'kysely';
import type { QueryExecutorProvider } from 'kysely';
import type { Row } from '../utils/types.ts';
import { toSQLValue } from './to-sql-value.ts';

export async function writeRow(
  db: QueryExecutorProvider,
  name: string,
  table: TableDeclaration,
  row: Row,
): Promise<void> {
  const columns = Object.entries(table.columns);
  const names = sql.join(columns.map(([column]) => sql.ref(column)));

  const values = sql.join(
    columns.map(([column, declaration]) => sql`${toSQLValue(declaration, row[column])}`),
  );

  await sql`insert or replace into ${sql.table(name)} (${names}) values (${values})`.execute(db);
}
