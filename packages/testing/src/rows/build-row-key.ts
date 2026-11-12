import type { TableDeclaration } from '@pepys/kit';
import type { Row } from '../utils/types.ts';

// The key of a row as the host writes it in `scope_row` and the change log, for a key of one column
// and of several. The host sorts an object's keys, so a key that holds an object can differ.
export function buildRowKey(table: TableDeclaration, row: Row): string {
  return JSON.stringify(table.primaryKey.map((column) => row[column] ?? null));
}
