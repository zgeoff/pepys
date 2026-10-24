import { collectTables } from './collect-tables.ts';
import { formatTypeScriptRow } from './format-typescript-row.ts';
import { toPascalCase } from './to-pascal-case.ts';
import type { ConsumerDeclaration } from './types.ts';

export function generateKyselyTypes(consumers: readonly ConsumerDeclaration[]): string {
  const tables = collectTables(consumers);
  const rows = tables.map((entry) => formatTypeScriptRow(entry.name, entry.table, 'string'));

  const database = [
    'export interface DB {',
    ...tables.map((entry) => `  ${entry.name}: ${toPascalCase(entry.name)}Row;`),
    '}',
  ].join('\n');

  return `${[...rows, database].join('\n\n')}\n`;
}
