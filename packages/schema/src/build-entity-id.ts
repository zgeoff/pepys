import { toTagged } from '@zgeoff/std';
import type { EntityIDFailure } from './entity-id-failure.ts';
import type { EntityIDParts } from './entity-id-parts.ts';
import { findEntityIDFailure } from './find-entity-id-failure.ts';
import type { EntityID, Result } from './types.ts';

export function buildEntityID(parts: EntityIDParts): Result<EntityID, EntityIDFailure> {
  const failure = findEntityIDFailure(parts);

  if (failure !== undefined) {
    return { ok: false, failure };
  }

  return { ok: true, value: toTagged<EntityID>(`${parts.source}:${parts.kind}:${parts.id}`) };
}
