import type { ColumnDeclaration } from '@pepys/kit';
import { match } from 'ts-pattern';

// A value of a checked row as SQLite stores it: a boolean as 0 or 1, a JSON column as its text.
export function toSQLValue(column: ColumnDeclaration, value: unknown): string | number | null {
  if (value === null || value === undefined) {
    return null;
  }

  return match(column.kind)
    .with('boolean', () => (value === true ? 1 : 0))
    .with('json', () => JSON.stringify(value))
    .with('integer', 'real', () => Number(value))
    .with('text', 'entityID', 'timestamp', () => String(value))
    .exhaustive();
}
