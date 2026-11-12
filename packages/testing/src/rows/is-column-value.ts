import type { ColumnDeclaration } from '@pepys/kit';
import { match } from 'ts-pattern';

// The host's check of one value against its column: of the column's kind, and null only where the
// column is nullable. `isInexact` marks a number the module wrote with a fraction or an exponent,
// such as `1.0`, which an integer column refuses.
export function isColumnValue(
  column: ColumnDeclaration,
  value: unknown,
  isInexact: boolean,
): boolean {
  if (value === null) {
    return column.nullable === true;
  }

  return match(column.kind)
    .with('text', 'entityID', 'timestamp', () => typeof value === 'string')
    .with('boolean', () => typeof value === 'boolean')
    .with('json', () => true)
    .with('real', () => typeof value === 'number')
    .with('integer', () => Number.isSafeInteger(value) && !isInexact)
    .exhaustive();
}
