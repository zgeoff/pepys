import type { TableDeclaration } from '@pepys/kit';
import invariant from 'tiny-invariant';
import type { Row } from '../utils/types.ts';
import { isColumnValue } from './is-column-value.ts';

// The host's check of a delete's key, in the host's order: no column outside the primary key, each
// key value present fit for its column, then each key column present.
export function findKeyProblem(
  table: TableDeclaration,
  key: Row,
  inexact: ReadonlySet<string>,
): string | undefined {
  const outside = Object.keys(key).find((name) => !table.primaryKey.includes(name));

  if (outside !== undefined) {
    return `${outside} is not a key column`;
  }

  const present = table.primaryKey.filter((name) => Object.hasOwn(key, name));

  const unfit = present.find((name) => {
    const column = table.columns[name];

    invariant(column, 'the deployment check refuses a key column that the table lacks');

    return !isColumnValue(column, key[name], inexact.has(name));
  });

  if (unfit !== undefined) {
    return `the column ${unfit} holds ${JSON.stringify(key[unfit])}`;
  }

  const absent = table.primaryKey.find((name) => !Object.hasOwn(key, name));

  return absent === undefined ? undefined : `the key column ${absent} is absent`;
}
