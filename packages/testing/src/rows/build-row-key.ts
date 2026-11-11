import type { TableDeclaration } from '@pepys/kit';
import type { Row } from '../utils/types.ts';

// The key of a row as the host writes it in `scope_row` and the change log: the JSON text of the
// primary key's values, in key order, for a key of one column and of several.
export function buildRowKey(table: TableDeclaration, row: Row): string {
  return JSON.stringify(table.primaryKey.map((column) => row[column] ?? null));
}
