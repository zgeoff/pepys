import type { EntityID } from '@pepys/kit';
import type { LastBody } from './collect-tied-entities.ts';

// A dropped copy of an earlier body may be a true return to an earlier state (A, B, A) when another
// body was stored for one of its entities since.
export function collectReturnedEntities(
  lastBodies: ReadonlyMap<EntityID, LastBody>,
  digest: string,
  entities: readonly EntityID[],
): EntityID[] {
  return entities.filter((entity) => {
    const last = lastBodies.get(entity);

    return last !== undefined && last.digest !== digest;
  });
}
