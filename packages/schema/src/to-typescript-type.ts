import { match } from 'ts-pattern';
import type { ColumnDeclaration } from './types.ts';

export function toTypeScriptType(column: ColumnDeclaration, entityIDType: string): string {
  const type = match(column.kind)
    .with('text', 'timestamp', () => 'string')
    .with('integer', 'real', () => 'number')
    .with('boolean', () => 'boolean')
    .with('json', () => 'unknown')
    .with('entityID', () => entityIDType)
    .exhaustive();

  return column.nullable === true && column.kind !== 'json' ? `${type} | null` : type;
}
