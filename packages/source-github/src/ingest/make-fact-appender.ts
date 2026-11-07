import type { AppendOutcome, FactLog } from '@pepys/ingest';
import type { FactEnvelope, FactID, StreamName, StreamOffset } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { match } from 'ts-pattern';

interface FactAppenderOptions {
  log: FactLog;
  stream: StreamName;
  maxAttempts: number;
  retryDelayMs: number;
}

// Each attempt appends at the tail it reads first. Appends wait for the one before them, so two
// webhooks at once never spend their attempts on each other's tail mismatch. After an attempt whose
// outcome is unknown, the next attempt looks for the fact ID first, so one copy lands.
export function makeFactAppender(
  options: FactAppenderOptions,
): (fact: FactEnvelope<unknown>) => Promise<void> {
  let previous = Promise.resolve();

  return async (fact) => {
    const turn = previous;
    const done = Promise.withResolvers<void>();

    previous = done.promise;

    try {
      await turn;
      await appendWithRetries(options, fact);
    } finally {
      done.resolve();
    }
  };
}

interface AppendState {
  // The tail before the first append, so any stored copy of the fact sits at or after it.
  start: StreamOffset | null;
  isUncertain: boolean;
}

async function appendWithRetries(
  options: FactAppenderOptions,
  fact: FactEnvelope<unknown>,
): Promise<void> {
  const state: AppendState = { start: null, isUncertain: false };

  for (let attempt = 1; ; attempt += 1) {
    const outcome = await appendOnce(options, fact, state).catch(
      (error: unknown): AppendOutcome => {
        console.error('an append attempt failed', error);

        return { kind: 'unknown' };
      },
    );

    const isDone = match(outcome)
      .with({ kind: 'acknowledged' }, () => true)
      .with({ kind: 'rejected', reason: 'tail-mismatch' }, () => false)
      .with({ kind: 'rejected' }, (rejected) => {
        throw new Error(`the log refused the fact: ${rejected.reason}`);
      })
      .with({ kind: 'unknown' }, () => {
        state.isUncertain = true;

        return false;
      })
      .exhaustive();

    if (isDone) {
      return;
    }

    if (attempt >= options.maxAttempts) {
      throw new Error(`the fact has no acknowledged append after ${attempt} attempts`);
    }

    await Bun.sleep(options.retryDelayMs * attempt);
  }
}

async function appendOnce(
  options: FactAppenderOptions,
  fact: FactEnvelope<unknown>,
  state: AppendState,
): Promise<AppendOutcome> {
  const tail = await options.log.readTail(options.stream);

  if (!tail.ok) {
    return { kind: 'rejected', reason: tail.failure.reason };
  }

  state.start ??= tail.value;

  if (state.isUncertain) {
    const offset = await readFactOffset(options, fact.id, state.start, tail.value);

    if (offset !== null) {
      return { kind: 'acknowledged', offset };
    }
  }

  return options.log.append(options.stream, fact, tail.value);
}

async function readFactOffset(
  options: FactAppenderOptions,
  id: FactID,
  from: StreamOffset,
  tail: StreamOffset,
): Promise<StreamOffset | null> {
  let next = from;

  while (next < tail) {
    const read = await options.log.read(options.stream, next, tail - next);

    if (!read.ok) {
      return null;
    }

    const stored = read.value.find((candidate) => candidate.fact.id === id);
    const last = read.value.at(-1);

    if (stored !== undefined) {
      return stored.offset;
    }

    if (last === undefined) {
      return null;
    }

    next = toTagged<StreamOffset>(last.offset + 1);
  }

  return null;
}
