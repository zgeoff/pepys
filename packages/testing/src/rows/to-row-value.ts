import type { ColumnDeclaration } from '@pepys/kit';
import { match } from 'ts-pattern';

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
