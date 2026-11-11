import type { FactEnvelope, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import type { StoredFact } from '../fact-log.ts';

// A fact as a log reads it back, at the offset it is given.
export function buildTestStoredFact(fact: FactEnvelope<unknown>, offset: number): StoredFact {
  return {
    offset: toTagged<StreamOffset>(offset),
    fact,
    body: JSON.stringify(fact),
    appendedAtMs: 0,
  };
}
