import { parseEntityID } from '@pepys/kit';
import type { EntityID } from '@pepys/kit';
import type { LoggedFact } from '../fact-index/types.ts';
import { compareCodePoints } from '../utils/compare-code-points.ts';

// The entities of the batch's facts that have the scope kind, each once, in sorted order. A copy of
// a fact marks its scope dirty too, and the replace then finds no change.
export function collectDirtyScopes(facts: readonly LoggedFact[], scopeKind: string): EntityID[] {
  const scopes = facts
    .map((record) => record.envelope.entity)
    .filter((entity) => {
      const parsed = parseEntityID(entity);

      return parsed.ok && `${parsed.value.source}:${parsed.value.kind}` === scopeKind;
    });

  return [...new Set(scopes)].toSorted(compareCodePoints);
}
