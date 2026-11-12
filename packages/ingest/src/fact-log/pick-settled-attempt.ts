import type { FactID, Result, StreamOffset } from '@pepys/kit';
import { match } from 'ts-pattern';
import type { StoredFact } from './fact-log.ts';
import type { AttemptResult } from './pick-attempt-step.ts';
import { pickSettlement } from './pick-settlement.ts';

// `stored` is the read of the offsets `[tail, tail + n)` that an attempt aimed at, or `null` when
// the read failed, which leaves the attempt open.
export function pickSettledAttempt(
  stored: Result<readonly StoredFact[], { reason: 'unknown-stream' }> | null,
  ids: readonly FactID[],
  tail: StreamOffset,
): AttemptResult {
  if (stored === null) {
    return { kind: 'again', pendingTail: tail };
  }

  if (!stored.ok) {
    return { kind: 'refused', failure: { kind: 'refused', reason: 'unknown-stream' } };
  }

  return match(pickSettlement(ids, stored.value))
    .with('landed', () => ({
      kind: 'stored' as const,
      stored: { firstOffset: tail, count: ids.length },
    }))
    .with('not-landed', () => ({ kind: 'again' as const, pendingTail: tail }))
    .with('taken', () => ({ kind: 'again' as const, pendingTail: null }))
    .exhaustive();
}
