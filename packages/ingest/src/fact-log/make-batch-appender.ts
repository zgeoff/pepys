import type { FactEnvelope, Logger, Result, StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import type { FactLog, StoredFact } from './fact-log.ts';
import { pickAttemptStep } from './pick-attempt-step.ts';
import type { AttemptResult } from './pick-attempt-step.ts';
import { pickRetryStep } from './pick-retry-step.ts';
import { pickSettledAttempt } from './pick-settled-attempt.ts';

interface BatchAppenderOptions {
  log: FactLog;
  logger: Logger;
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

      const step = pickRetryStep(result, attempt, options);

      if (step.kind === 'answer') {
        return step.answer;
      }

      pendingTail = step.pendingTail;

      await Bun.sleep(step.delayMs);
    }
  };
}

// Every attempt that is still open aimed at the same tail: a new tail comes only after the offsets
// there are known to hold another writer's records.
async function runAttempt(
  options: Pick<BatchAppenderOptions, 'log' | 'logger'>,
  stream: StreamName,
  facts: readonly FactEnvelope<unknown>[],
  pendingTail: StreamOffset | null,
): Promise<AttemptResult> {
  const aim =
    pendingTail === null
      ? await readAimedTail(options, stream)
      : { kind: 'aim' as const, tail: pendingTail };

  if (aim.kind !== 'aim') {
    return aim;
  }

  const outcome = await options.log.appendBatch(stream, facts, aim.tail);

  const step = pickAttemptStep(outcome, aim.tail, pendingTail);

  return step.kind === 'settle' ? settleAttempt(options, stream, facts, step.tail) : step;
}

// A failed read stored nothing, so the next attempt repeats it. An error the append throws is a
// refusal the log gives no outcome for, such as a bad token, and a retry cannot change it.
async function readAimedTail(
  options: Pick<BatchAppenderOptions, 'log' | 'logger'>,
  stream: StreamName,
): Promise<{ kind: 'aim'; tail: StreamOffset } | AttemptResult> {
  try {
    const tail = await options.log.readTail(stream);

    return tail.ok
      ? { kind: 'aim', tail: tail.value }
      : { kind: 'refused', failure: { kind: 'refused', reason: 'unknown-stream' } };
  } catch (error: unknown) {
    options.logger.error('a read before an append failed', error);

    return { kind: 'again', pendingTail: null };
  }
}

// Reads exactly the offsets `[tail, tail + n)` that an attempt aimed at, and compares their fact IDs
// with the run's, in order. A search for the first ID anywhere after the tail would take another
// writer's copy of it for the whole run.
async function settleAttempt(
  options: Pick<BatchAppenderOptions, 'log' | 'logger'>,
  stream: StreamName,
  facts: readonly FactEnvelope<unknown>[],
  tail: StreamOffset,
): Promise<AttemptResult> {
  const stored = await readRun(options.log, stream, tail, facts.length).catch((error: unknown) => {
    options.logger.error('a read that settles an append failed', error);

    return null;
  });

  return pickSettledAttempt(
    stored,
    facts.map((fact) => fact.id),
    tail,
  );
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
