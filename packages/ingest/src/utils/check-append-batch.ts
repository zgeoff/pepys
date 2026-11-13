import type { FactEnvelope, Result } from '@pepys/kit';
import { parseStoredBody } from './parse-stored-body.ts';

// The limits of one s2-lite append. A record meters as its stored body in UTF-8 bytes plus 8, and
// pepys records have no headers.
export const appendLimits = { records: 1000, meteredBytes: 1_048_576 } as const;
const recordOverheadBytes = 8;

export type AppendBatchProblem =
  | { reason: 'too-large' }
  | { reason: 'invalid-envelope'; index: number };

// The metered size of a stored body.
export function toMeteredBytes(body: string): number {
  return Buffer.byteLength(body, 'utf8') + recordOverheadBytes;
}

// Checks what an append needs before it reaches a stream, so every adapter refuses what s2-lite
// refuses. An empty batch, or one over the record limit, is too large; then each fact must parse as
// an envelope; then the batch must fit the byte limit. Returns the stored bodies, in order.
export function checkAppendBatch(
  facts: readonly FactEnvelope<unknown>[],
): Result<readonly string[], AppendBatchProblem> {
  if (facts.length === 0 || facts.length > appendLimits.records) {
    return { ok: false, failure: { reason: 'too-large' } };
  }

  const bodies: string[] = [];

  for (const [index, fact] of facts.entries()) {
    const body = parseStoredBody(fact);

    if (body === null) {
      return { ok: false, failure: { reason: 'invalid-envelope', index } };
    }

    bodies.push(body);
  }

  const meteredBytes = bodies.reduce((sum, body) => sum + toMeteredBytes(body), 0);

  return meteredBytes > appendLimits.meteredBytes
    ? { ok: false, failure: { reason: 'too-large' } }
    : { ok: true, value: bodies };
}
