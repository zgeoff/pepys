import type { Batch, Result, SourceContext } from '@pepys/kit';
import { findBatchProblem } from './find-batch-problem.ts';
import { planBatch } from './plan-batch.ts';
import type { BatchPlan } from './plan-batch.ts';

export interface BatchRefusal {
  kind: 'bad-batch' | 'has-blob' | 'too-large';
  reason: string;
}

// The checks a batch passes before any of it is written, in order: every fact's stream and
// envelope, no fact with a blob, then the cut into appends.
export function pickBatchPlan(
  source: SourceContext,
  batch: Batch,
): Result<BatchPlan, BatchRefusal> {
  const problem = findBatchProblem(source, batch);

  if (problem !== undefined) {
    return { ok: false, failure: { kind: 'bad-batch', reason: problem } };
  }

  if (batch.facts.some((pending) => pending.blobs.length > 0)) {
    return { ok: false, failure: { kind: 'has-blob', reason: 'ingest has no blob store' } };
  }

  const plan = planBatch(batch);

  if (!plan.ok) {
    return {
      ok: false,
      failure: { kind: 'too-large', reason: 'one fact is larger than one append of the log takes' },
    };
  }

  return plan;
}
