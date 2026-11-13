import type { ColumnDeclaration, TableDeclaration } from '@pepys/kit';
import { match } from 'ts-pattern';

export function buildEntityRow(
  table: TableDeclaration,
  stored: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(table.columns).map(([name, column]) => [name, toValue(column, stored[name])]),
  );
}

function toValue(column: ColumnDeclaration, stored: unknown): unknown {
  return match(column.kind)
    .with('boolean', () => (stored === null ? null : stored === 1))
    .with('json', (): unknown => (typeof stored === 'string' ? JSON.parse(stored) : stored))
    .with('text', 'integer', 'real', 'entityID', 'timestamp', () => stored)
    .exhaustive();
}
