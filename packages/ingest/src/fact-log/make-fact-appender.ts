import type { FactEnvelope, FactID, StreamName, StreamOffset } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { match } from 'ts-pattern';
import type { FactLog, StoredFact } from './fact-log.ts';
import { pickAppendStep } from './pick-append-step.ts';
import type { AppendStep } from './pick-append-step.ts';

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

// A failed read stored nothing, so the next attempt repeats it. An error the append throws is a
// refusal the log gives no outcome for, such as a bad token, and a retry cannot change it.
async function appendWithRetries(
  options: FactAppenderOptions,
  fact: FactEnvelope<unknown>,
): Promise<void> {
  const state: AppendState = { start: null, isUncertain: false };

  for (let attempt = 1; ; attempt += 1) {
    const step = await readAppendStep(options, fact.id, state).catch((error: unknown) => {
      console.error('a read before an append failed', error);

      return null;
    });

    const isStored = step === null ? false : await runAppendStep(options, fact, step, state);

    if (isStored) {
      return;
    }

    if (attempt >= options.maxAttempts) {
      throw new Error(`the fact has no acknowledged append after ${attempt} attempts`);
    }

    await Bun.sleep(options.retryDelayMs * attempt);
  }
}

async function readAppendStep(
  options: FactAppenderOptions,
  id: FactID,
  state: AppendState,
): Promise<AppendStep> {
  const tail = await options.log.readTail(options.stream);

  if (!tail.ok) {
    return pickAppendStep(id, tail, []);
  }

  state.start ??= tail.value;

  const storedFacts = state.isUncertain
    ? await readFactsBetween(options, state.start, tail.value)
    : [];

  return pickAppendStep(id, tail, storedFacts);
}

async function readFactsBetween(
  options: FactAppenderOptions,
  from: StreamOffset,
  tail: StreamOffset,
): Promise<StoredFact[]> {
  const storedFacts: StoredFact[] = [];
  let next = from;

  while (next < tail) {
    const read = await options.log.read(options.stream, next, tail - next);

    const last = read.ok ? read.value.at(-1) : undefined;

    if (!read.ok || last === undefined) {
      return storedFacts;
    }

    storedFacts.push(...read.value);

    next = toTagged<StreamOffset>(last.offset + 1);
  }

  return storedFacts;
}

// Returns whether the fact is in the log.
function runAppendStep(
  options: FactAppenderOptions,
  fact: FactEnvelope<unknown>,
  step: AppendStep,
  state: AppendState,
): Promise<boolean> {
  return match(step)
    .with({ kind: 'found' }, () => Promise.resolve(true))
    .with({ kind: 'refused' }, (refused) =>
      Promise.reject(new Error(`the log refused the fact: ${refused.reason}`)),
    )
    .with({ kind: 'append' }, (append) => appendAtTail(options, fact, append.expectedTail, state))
    .exhaustive();
}

async function appendAtTail(
  options: FactAppenderOptions,
  fact: FactEnvelope<unknown>,
  expectedTail: StreamOffset,
  state: AppendState,
): Promise<boolean> {
  const outcome = await options.log.append(options.stream, fact, expectedTail);

  return match(outcome)
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
}
