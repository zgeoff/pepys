import type { ColumnDeclaration } from '@pepys/kit';
import { match } from 'ts-pattern';

// A stored value as the module wrote it: 0 or 1 back to a boolean, a JSON column's text parsed.
export function toRowValue(column: ColumnDeclaration, stored: unknown): unknown {
  if (stored === null || stored === undefined) {
    return null;
  }

  return match(column.kind)
    .with('boolean', () => stored === 1)
    .with('json', (): unknown => (typeof stored === 'string' ? JSON.parse(stored) : stored))
    .with('integer', 'real', 'text', 'entityID', 'timestamp', () => stored)
    .exhaustive();
}
