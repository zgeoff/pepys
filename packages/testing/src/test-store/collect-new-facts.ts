import type { FactID } from '@pepys/kit';
import type { LoggedFact } from '../fact-index/types.ts';

// The facts a fact-mode consumer has yet to apply, in batch order: a fact ID it applied before, or
// one an earlier fact of the batch holds, is a copy and runs no second time.
export function collectNewFacts(
  facts: readonly LoggedFact[],
  applied: ReadonlySet<FactID>,
): LoggedFact[] {
  const seen = new Set(applied);

  return facts.filter((record) => {
    if (seen.has(record.envelope.id)) {
      return false;
    }

    seen.add(record.envelope.id);

    return true;
  });
}
