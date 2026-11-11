import type { TableDeclaration } from '@pepys/kit';
import { match } from 'ts-pattern';
import type { Row } from '../utils/types.ts';

// The host's check of a row: every column present, no other key, each value of its column's kind,
// and null only where the column is nullable. `inexact` names the columns whose number the module
// wrote with a fraction or an exponent, such as `1.0`: an integer column refuses those.
export function findRowProblem(
  table: TableDeclaration,
  row: Row,
  inexact: ReadonlySet<string>,
): string | undefined {
  const unknown = Object.keys(row).find((name) => !Object.hasOwn(table.columns, name));

  if (unknown !== undefined) {
    return `${unknown} is not a column`;
  }

  for (const [name, column] of Object.entries(table.columns)) {
    if (!Object.hasOwn(row, name)) {
      return `the column ${name} is absent`;
    }

    const value = row[name];

    const fits =
      value === null
        ? column.nullable === true
        : match(column.kind)
            .with('text', 'entityID', 'timestamp', () => typeof value === 'string')
            .with('boolean', () => typeof value === 'boolean')
            .with('json', () => true)
            .with('real', () => typeof value === 'number')
            .with('integer', () => Number.isSafeInteger(value) && !inexact.has(name))
            .exhaustive();

    if (!fits) {
      return `the column ${name} holds ${JSON.stringify(value)}`;
    }
  }

  return undefined;
}
