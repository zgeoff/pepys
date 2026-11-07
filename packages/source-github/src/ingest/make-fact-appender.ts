import type { AppendOutcome, FactLog } from '@pepys/ingest';
import type { FactEnvelope, StreamName } from '@pepys/schema';
import { match } from 'ts-pattern';

interface FactAppenderOptions {
  log: FactLog;
  stream: StreamName;
  maxAttempts: number;
  retryDelayMs: number;
}

// Each attempt appends at the tail it reads first. An attempt whose outcome is unknown may still
// have been stored, so the appender sends the fact again; the fact ID makes a stored copy harmless
// to the consumers.
export function makeFactAppender(
  options: FactAppenderOptions,
): (fact: FactEnvelope<unknown>) => Promise<void> {
  return async (fact) => {
    for (let attempt = 1; ; attempt += 1) {
      const outcome = await appendAtTail(options, fact).catch((error: unknown): AppendOutcome => {
        console.error('an append attempt failed', error);

        return { kind: 'unknown' };
      });

      const isDone = match(outcome)
        .with({ kind: 'acknowledged' }, () => true)
        .with({ kind: 'rejected', reason: 'tail-mismatch' }, () => false)
        .with({ kind: 'rejected' }, (rejected) => {
          throw new Error(`the log refused the fact: ${rejected.reason}`);
        })
        .with({ kind: 'unknown' }, () => false)
        .exhaustive();

      if (isDone) {
        return;
      }

      if (attempt >= options.maxAttempts) {
        throw new Error(`the fact has no acknowledged append after ${attempt} attempts`);
      }

      await Bun.sleep(options.retryDelayMs * attempt);
    }
  };
}

async function appendAtTail(
  options: FactAppenderOptions,
  fact: FactEnvelope<unknown>,
): Promise<AppendOutcome> {
  const tail = await options.log.readTail(options.stream);

  if (!tail.ok) {
    return { kind: 'rejected', reason: tail.failure.reason };
  }

  return options.log.append(options.stream, fact, tail.value);
}
