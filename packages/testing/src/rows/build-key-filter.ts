import type { TableDeclaration } from '@pepys/kit';
import { sql } from 'kysely';
import type { RawBuilder } from 'kysely';
import { toSQLValue } from './to-sql-value.ts';

// The `where` clause of one row, from the JSON text of its key's values.
export function buildKeyFilter(table: TableDeclaration, key: string): RawBuilder<unknown> {
  const parsed: unknown = JSON.parse(key);
  const values: readonly unknown[] = Array.isArray(parsed) ? parsed : [];

  return sql.join(
    table.primaryKey.map((column, index) => {
      const declaration = table.columns[column] ?? { kind: 'text' };

      return sql`${sql.ref(column)} = ${toSQLValue(declaration, values[index])}`;
    }),
    sql` and `,
  );
}
