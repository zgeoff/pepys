import type { FactEnvelope, Result } from '@pepys/kit';
import { appendLimits, toMeteredBytes } from './check-append-batch.ts';
import { parseStoredBody } from './parse-stored-body.ts';

type Run = readonly FactEnvelope<unknown>[];

// Cuts the facts of one stream, in order, into runs that each stay inside the append limits. A run
// closes when the next fact would make it 1001 records or more than 1,048,576 metered bytes. Fact
// `index` is too large when it alone meters more than one append takes.
export function planAppends(
  facts: readonly FactEnvelope<unknown>[],
): Result<readonly Run[], { reason: 'too-large'; index: number }> {
  const runs: FactEnvelope<unknown>[][] = [];
  let run: FactEnvelope<unknown>[] = [];
  let runBytes = 0;

  for (const [index, fact] of facts.entries()) {
    // A fact that fails the envelope check meters as 0: the append refuses it by its own check.
    const bytes = toMeteredBytes(parseStoredBody(fact) ?? '');

    if (bytes > appendLimits.meteredBytes) {
      return { ok: false, failure: { reason: 'too-large', index } };
    }

    const isFull =
      run.length + 1 > appendLimits.records || runBytes + bytes > appendLimits.meteredBytes;

    if (isFull) {
      runs.push(run);

      run = [];
      runBytes = 0;
    }

    run.push(fact);

    runBytes += bytes;
  }

  if (run.length > 0) {
    runs.push(run);
  }

  return { ok: true, value: runs };
}
