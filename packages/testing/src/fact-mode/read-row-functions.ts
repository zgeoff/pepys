import type { ConsumerDeclaration } from '@pepys/kit';
import { toPascalCase } from '@pepys/kit/generators';
import { buildReadFunctions } from '../consumer-entries/build-read-functions.ts';
import type { HostFunctions } from '../consumer-entries/run-entry.ts';
import { readTableRows } from '../rows/read-table-rows.ts';
import type { StoreDatabase } from '../store-database/types.ts';

// The row reads of a fact-mode consumer, over the rows its `reads` tables hold now. A module reads
// synchronously, so the rows are read before each call. The argument of a read is the key: the
// value of a key of one column as text, or the JSON text of the values of a key of several.
export async function readRowFunctions(
  db: StoreDatabase,
  consumer: ConsumerDeclaration,
): Promise<HostFunctions> {
  const functions: HostFunctions[] = [];

  for (const name of consumer.reads) {
    const table = consumer.tables[name];
    const rows = table === undefined ? [] : await readTableRows(db, name, table);

    const texts = new Map(
      rows.map((row) => {
        const values = (table?.primaryKey ?? []).map((column) => row[column]);
        const key = values.length === 1 ? String(values[0]) : JSON.stringify(values);

        return [key, JSON.stringify(row)];
      }),
    );

    functions.push(buildReadFunctions(`read${toPascalCase(name)}`, texts, 'none'));
  }

  return Object.fromEntries(functions.flatMap((pair) => Object.entries(pair)));
}
