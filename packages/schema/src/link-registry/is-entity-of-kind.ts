import { parseEntityID } from '../entity-ids/parse-entity-id.ts';
import type { EntityID } from '../ids/types.ts';
import type { EntityKind, KindedID } from './link-registry.ts';

export function isEntityOfKind<Kind extends EntityKind>(
  id: EntityID,
  kinds: readonly Kind[],
): id is KindedID<Kind> {
  const parsed = parseEntityID(id);

  return parsed.ok && kinds.some((kind) => kind === `${parsed.value.source}:${parsed.value.kind}`);
}
