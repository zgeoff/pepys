import type { EntityKind } from '../link-types/types.ts';
import { toPascalCase } from './to-pascal-case.ts';

export function toEntityIDTypeName(kind: EntityKind): string {
  return `${toPascalCase(kind)}ID`;
}
