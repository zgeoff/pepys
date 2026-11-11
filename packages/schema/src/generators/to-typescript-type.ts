import type { ColumnDeclaration } from '@pepys/kit';
import { match } from 'ts-pattern';

export interface TypeScriptTypeNames {
  entityID: string;
  boolean: string;
}

export function toTypeScriptType(column: ColumnDeclaration, names: TypeScriptTypeNames): string {
  const type = match(column.kind)
    .with('text', 'timestamp', () => 'string')
    .with('integer', 'real', () => 'number')
    .with('boolean', () => names.boolean)
    .with('json', () => 'unknown')
    .with('entityID', () => names.entityID)
    .exhaustive();

  return column.nullable === true && column.kind !== 'json' ? `${type} | null` : type;
}
