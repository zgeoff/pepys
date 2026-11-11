import { parseEntityID } from '@pepys/kit';
import type { EntityID, EntityKind } from '@pepys/kit';
import type { KindedID } from './link-registry.ts';

export function isEntityOfKind<Kind extends EntityKind>(
  id: EntityID,
  kinds: readonly Kind[],
): id is KindedID<Kind> {
  const parsed = parseEntityID(id);

  return parsed.ok && kinds.some((kind) => kind === `${parsed.value.source}:${parsed.value.kind}`);
}
