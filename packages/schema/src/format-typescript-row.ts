import { toPascalCase } from './to-pascal-case.ts';
import { toTypeScriptType } from './to-typescript-type.ts';
import type { TableDeclaration } from './types.ts';

export function formatTypeScriptRow(
  tableName: string,
  table: TableDeclaration,
  entityIDType: string,
): string {
  const fields = Object.entries(table.columns).map(
    ([name, column]) => `  ${name}: ${toTypeScriptType(column, entityIDType)};`,
  );

  return [`export interface ${toPascalCase(tableName)}Row {`, ...fields, '}'].join('\n');
}
