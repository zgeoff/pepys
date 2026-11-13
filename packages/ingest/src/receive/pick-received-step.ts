import type { PendingFact, Received, SourceContext } from '@pepys/kit';
import { match } from 'ts-pattern';
import { pickBatchPlan } from '../utils/pick-batch-plan.ts';
import type { BatchPlan } from '../utils/plan-batch.ts';

// `has-blob`: the source read a fact with a blob, a fault of the deployment that ingest answers 500.
export type ReceivedStep =
  | { kind: 'refuse'; status: number; reason: string }
  | { kind: 'has-blob' }
  | { kind: 'ignore' }
  | { kind: 'write'; facts: readonly PendingFact[]; plan: BatchPlan };

// What follows the source's read of a delivery, `threw` when the read threw.
export function pickReceivedStep(
  source: Pick<SourceContext, 'name' | 'families'>,
  received: Received | 'threw',
  factLimit: number,
): ReceivedStep {
  if (received === 'threw') {
    return { kind: 'refuse', status: 500, reason: 'the source could not read the delivery' };
  }

  if (received.kind === 'refused') {
    return { kind: 'refuse', status: received.status, reason: received.reason };
  }

  if (received.kind === 'ignored' || received.batch.facts.length === 0) {
    return { kind: 'ignore' };
  }

  const facts = received.batch.facts;

  if (facts.length > factLimit) {
    return { kind: 'refuse', status: 413, reason: `a batch holds ${factLimit} facts at most` };
  }

  const plan = pickBatchPlan(source, received.batch);

  if (!plan.ok) {
    return match(plan.failure.kind)
      .with('bad-batch', () => ({
        kind: 'refuse' as const,
        status: 422,
        reason: plan.failure.reason,
      }))
      .with('has-blob', () => ({ kind: 'has-blob' as const }))
      .with('too-large', () => ({
        kind: 'refuse' as const,
        status: 413,
        reason: plan.failure.reason,
      }))
      .exhaustive();
  }

  return { kind: 'write', facts, plan: plan.value };
}
