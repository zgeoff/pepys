import type { Batch, FactEnvelope, Result, StreamName } from '@pepys/kit';
import { planAppends } from '../fact-log/plan-appends.ts';

export type BatchPlan = ReadonlyMap<StreamName, readonly (readonly FactEnvelope<unknown>[])[]>;

// Groups the facts by stream, in batch order, and cuts each stream's facts into appends. One fact
// that no append can hold refuses the whole batch, so a batch never stores in part for its content.
export function planBatch(batch: Batch): Result<BatchPlan, { reason: 'too-large' }> {
  const byStream = new Map<StreamName, FactEnvelope<unknown>[]>();

  for (const pending of batch.facts) {
    const facts = byStream.get(pending.stream) ?? [];

    facts.push(pending.fact);
    byStream.set(pending.stream, facts);
  }

  const plan = new Map<StreamName, readonly (readonly FactEnvelope<unknown>[])[]>();

  for (const [stream, facts] of byStream) {
    const runs = planAppends(facts);

    if (!runs.ok) {
      return { ok: false, failure: { reason: 'too-large' } };
    }

    plan.set(stream, runs.value);
  }

  return { ok: true, value: plan };
}
