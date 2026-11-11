import type { FactID, Result, StreamOffset } from '@pepys/kit';
import type { StoredFact } from './fact-log.ts';

export type AppendStep =
  | { kind: 'found'; offset: StreamOffset }
  | { kind: 'append'; expectedTail: StreamOffset }
  | { kind: 'refused'; reason: 'unknown-stream' };

// `storedFacts` holds the facts stored since the first attempt, read only after an attempt whose
// outcome is unknown, so a fact that landed then is found here and never appended twice.
export function pickAppendStep(
  id: FactID,
  tail: Result<StreamOffset, { reason: 'unknown-stream' }>,
  storedFacts: readonly StoredFact[],
): AppendStep {
  if (!tail.ok) {
    return { kind: 'refused', reason: tail.failure.reason };
  }

  const stored = storedFacts.find((candidate) => candidate.fact.id === id);

  if (stored !== undefined) {
    return { kind: 'found', offset: stored.offset };
  }

  return { kind: 'append', expectedTail: tail.value };
}
