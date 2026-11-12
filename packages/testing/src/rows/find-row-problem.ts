import type { TableDeclaration } from '@pepys/kit';
import type { Row } from '../utils/types.ts';
import { isColumnValue } from './is-column-value.ts';

// The host's check of a row: every column present, no other key, and each value fit for its
// column. `inexact` names the columns whose number the module wrote with a fraction or an exponent.
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

    if (!isColumnValue(column, row[name], inexact.has(name))) {
      return `the column ${name} holds ${JSON.stringify(row[name])}`;
    }
  }

  return undefined;
}
