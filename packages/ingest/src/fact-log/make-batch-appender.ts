import type { FactEnvelope, Result, StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { P, match } from 'ts-pattern';
import type { FactLog, StoredFact } from './fact-log.ts';
import { pickSettlement } from './pick-settlement.ts';

interface BatchAppenderOptions {
  log: FactLog;
  maxAttempts: number;
  retryDelayMs: number;
}

// `refused`: the log gave a reason that no retry changes. `not-stored`: no acknowledgement after
// `attempts` attempts, so the facts may or may not be in the log.
export type AppendFailure =
  | { kind: 'refused'; reason: 'unknown-stream' | 'invalid-envelope' | 'too-large' }
  | { kind: 'not-stored'; attempts: number };

export type BatchAppender = (
  stream: StreamName,
  facts: readonly FactEnvelope<unknown>[],
) => Promise<Result<{ firstOffset: StreamOffset; count: number }, AppendFailure>>;

// Owns the retries of one append. The guard goes on every attempt, the first included. After an
// attempt whose outcome is unknown, the appender reads the offsets that the attempt aimed at before
// it sends another, so the run is stored once.
export function makeBatchAppender(options: BatchAppenderOptions): BatchAppender {
  return async (stream, facts) => {
    let pendingTail: StreamOffset | null = null;

    for (let attempt = 1; ; attempt += 1) {
      const result = await runAttempt(options, stream, facts, pendingTail);

      if (result.kind === 'stored') {
        return { ok: true, value: result.stored };
      }

      if (result.kind === 'refused') {
        return { ok: false, failure: result.failure };
      }

      pendingTail = result.pendingTail;

      if (attempt >= options.maxAttempts) {
        return { ok: false, failure: { kind: 'not-stored', attempts: attempt } };
      }

      await Bun.sleep(options.retryDelayMs * attempt);
    }
  };
}

interface Stored {
  firstOffset: StreamOffset;
  count: number;
}

type StopFailure = Extract<AppendFailure, { kind: 'refused' }>;

// What one attempt leaves: the answer, or the tail that earlier attempts with an unknown outcome
// aimed at, which a later attempt can still land on. `null` when no such attempt is open.
type AttemptResult =
  | { kind: 'stored'; stored: Stored }
  | { kind: 'refused'; failure: StopFailure }
  | { kind: 'again'; pendingTail: StreamOffset | null };

async function runAttempt(
  options: BatchAppenderOptions,
  stream: StreamName,
  facts: readonly FactEnvelope<unknown>[],
  pendingTail: StreamOffset | null,
): Promise<AttemptResult> {
  // Every attempt that is still open aimed at the same tail: a new tail comes only after the
  // offsets there are known to hold another writer's records.
  const read =
    pendingTail === null
      ? await readTail(options.log, stream)
      : { ok: true as const, value: pendingTail };

  if (read === null) {
    return { kind: 'again', pendingTail };
  }

  if (!read.ok) {
    return { kind: 'refused', failure: read.failure };
  }

  const aimed = read.value;

  const outcome = await options.log.appendBatch(stream, facts, aimed);

  return match(outcome)
    .with({ kind: 'acknowledged' }, (acknowledged) => ({
      kind: 'stored' as const,
      stored: { firstOffset: acknowledged.firstOffset, count: acknowledged.count },
    }))
    .with({ kind: 'rejected', reason: 'tail-mismatch' }, () =>
      pendingTail === null
        ? { kind: 'again' as const, pendingTail }
        : settleAttempt(options, stream, facts, aimed),
    )
    .with(
      { kind: 'rejected', reason: P.union('unknown-stream', 'invalid-envelope', 'too-large') },
      (rejected) => ({
        kind: 'refused' as const,
        failure: { kind: 'refused' as const, reason: rejected.reason },
      }),
    )
    .with({ kind: 'unknown' }, () => settleAttempt(options, stream, facts, aimed))
    .exhaustive();
}

// A failed read stored nothing, so the next attempt repeats it. Returns `null` for a failed read,
// and the failure for a stream the log lacks. An error the append throws is a refusal the log gives
// no outcome for, such as a bad token, and a retry cannot change it.
async function readTail(
  log: FactLog,
  stream: StreamName,
): Promise<Result<StreamOffset, StopFailure> | null> {
  try {
    const tail = await log.readTail(stream);

    return tail.ok ? tail : { ok: false, failure: { kind: 'refused', reason: 'unknown-stream' } };
  } catch (error: unknown) {
    console.error('a read before an append failed', error);

    return null;
  }
}

// Reads exactly the offsets `[tail, tail + n)` that an attempt aimed at, and compares their fact IDs
// with the run's, in order. A search for the first ID anywhere after the tail would take another
// writer's copy of it for the whole run.
async function settleAttempt(
  options: BatchAppenderOptions,
  stream: StreamName,
  facts: readonly FactEnvelope<unknown>[],
  tail: StreamOffset,
): Promise<AttemptResult> {
  const stored = await readRun(options.log, stream, tail, facts.length).catch((error: unknown) => {
    console.error('a read that settles an append failed', error);

    return null;
  });

  if (stored === null) {
    return { kind: 'again', pendingTail: tail };
  }

  if (!stored.ok) {
    return { kind: 'refused', failure: { kind: 'refused', reason: 'unknown-stream' } };
  }

  return match(
    pickSettlement(
      facts.map((fact) => fact.id),
      stored.value,
    ),
  )
    .with('landed', () => ({
      kind: 'stored' as const,
      stored: { firstOffset: tail, count: facts.length },
    }))
    .with('not-landed', () => ({ kind: 'again' as const, pendingTail: tail }))
    .with('taken', () => ({ kind: 'again' as const, pendingTail: null }))
    .exhaustive();
}

// A read can end before `count` records, so it repeats from the next offset until it has them all
// or the stream ends.
async function readRun(
  log: FactLog,
  stream: StreamName,
  from: StreamOffset,
  count: number,
): Promise<Result<readonly StoredFact[], { reason: 'unknown-stream' }>> {
  const records: StoredFact[] = [];

  while (records.length < count) {
    const read = await log.read(
      stream,
      toTagged<StreamOffset>(from + records.length),
      count - records.length,
    );

    if (!read.ok) {
      return read;
    }

    if (read.value.length === 0) {
      break;
    }

    records.push(...read.value);
  }

  return { ok: true, value: records };
}
