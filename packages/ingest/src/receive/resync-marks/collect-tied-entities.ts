import type { EntityID } from '@pepys/kit';

export interface LastBody {
  digest: string;
  at: string;
  locator: string | undefined;
}

export interface StoredFactTime {
  entity: EntityID;
  at: string;
  locator: string | undefined;
}

// A new body ties with the last body stored for an entity when both have the same time and differ.
// Two bodies with one time cannot be ordered by their facts, so the resync pull reads the entity.
export function collectTiedEntities(
  lastBodies: ReadonlyMap<EntityID, LastBody>,
  digest: string,
  facts: readonly StoredFactTime[],
): EntityID[] {
  return facts
    .filter((fact) => {
      const last = lastBodies.get(fact.entity);

      return last !== undefined && last.at === fact.at && last.digest !== digest;
    })
    .map((fact) => fact.entity);
}
