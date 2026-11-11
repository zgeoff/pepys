import type { FactID } from '@pepys/kit';
import type { StoredFact } from './fact-log.ts';

// `landed`: the run is stored whole at the offsets the attempt aimed at. `not-landed`: nothing is
// there, so the attempt may still be in flight. `taken`: another writer took the offsets, so the
// attempt can never land.
export type Settlement = 'landed' | 'not-landed' | 'taken';

// `stored` holds what the log gives for the offsets `[t, t + n)` that an attempt aimed at. One
// append is whole, so a match of fewer than n IDs is another writer's records, never part of the run.
export function pickSettlement(ids: readonly FactID[], stored: readonly StoredFact[]): Settlement {
  if (stored.length === 0) {
    return 'not-landed';
  }

  const isSameRun =
    stored.length === ids.length && stored.every((record, index) => record.fact.id === ids[index]);

  return isSameRun ? 'landed' : 'taken';
}
