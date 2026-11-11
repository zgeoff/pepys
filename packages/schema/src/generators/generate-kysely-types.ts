import type { ConsumerDeclaration } from '@pepys/kit';
import { toPascalCase } from '@pepys/kit/generators';
import { collectTables } from './collect-tables.ts';
import { formatTypeScriptRow } from './format-typescript-row.ts';

export function generateKyselyTypes(consumers: readonly ConsumerDeclaration[]): string {
  const tables = collectTables(consumers);

  // SQLite has no boolean type, so the driver reads a boolean column back as 0 or 1
  const rows = tables.map((entry) =>
    formatTypeScriptRow(entry.name, entry.table, { entityID: 'string', boolean: '0 | 1' }),
  );

  const database = [
    'export interface DB {',
    ...tables.map((entry) => `  ${entry.name}: ${toPascalCase(entry.name)}Row;`),
    '}',
  ].join('\n');

  return `${[...rows, database].join('\n\n')}\n`;
}
