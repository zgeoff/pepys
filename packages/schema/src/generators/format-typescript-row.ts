import type { TableDeclaration } from '@pepys/kit';
import { toPascalCase } from '@pepys/kit/generators';
import { toTypeScriptType } from './to-typescript-type.ts';
import type { TypeScriptTypeNames } from './to-typescript-type.ts';

export function formatTypeScriptRow(
  tableName: string,
  table: TableDeclaration,
  names: TypeScriptTypeNames,
): string {
  const fields = Object.entries(table.columns).map(
    ([name, column]) => `  ${name}: ${toTypeScriptType(column, names)};`,
  );

  return [`export interface ${toPascalCase(tableName)}Row {`, ...fields, '}'].join('\n');
}
