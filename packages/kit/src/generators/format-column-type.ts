import { match } from 'ts-pattern';
import type { EntityKind } from '../link-types/types.ts';
import type { ColumnDeclaration } from '../types.ts';
import { toEntityIDTypeName } from './to-entity-id-type-name.ts';

export function formatColumnType(column: ColumnDeclaration, kind: EntityKind | undefined): string {
  const type = match(column.kind)
    .with('text', 'timestamp', () => 'string')
    .with('integer', 'real', () => 'number')
    .with('boolean', () => 'boolean')
    .with('json', () => 'unknown')
    .with('entityID', () => (kind === undefined ? 'EntityID' : toEntityIDTypeName(kind)))
    .exhaustive();

  return column.nullable === true && column.kind !== 'json' ? `${type} | null` : type;
}
