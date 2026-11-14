import type { Logger } from '@pepys/kit';
import { pickStartStep } from './pick-start-step.ts';

interface WaitOptions {
  signal: AbortSignal;
}

interface StartRetry {
  // `setTimeout` of `node:timers/promises`: settles after the delay, and rejects on an abort
  wait: (delayMs: number, value: undefined, options: WaitOptions) => Promise<unknown>;

  // aborts when ingest stops before its start ends
  signal: AbortSignal;
  logger: Logger;
}

export type StartRun<Value> =
  | { kind: 'started'; value: Value }
  | { kind: 'stopped' }
  | { kind: 'failed'; error: unknown };

// Runs the part of the start that reads and writes the fact log, and runs it again after each
// failure that a later try can pass.
export async function runStartWithRetry<Value>(
  start: () => Promise<Value>,
  retry: StartRetry,
): Promise<StartRun<Value>> {
  let failures = 0;

  while (!retry.signal.aborted) {
    try {
      return { kind: 'started', value: await start() };
    } catch (error: unknown) {
      failures += 1;

      const step = pickStartStep(error, failures);

      if (step.kind === 'stop') {
        return { kind: 'failed', error };
      }

      retry.logger.error(
        `the fact log failed the start of ingest, which tries again in ${step.delayMs} ms`,
        error,
      );

      await retry.wait(step.delayMs, undefined, { signal: retry.signal }).catch(() => {});
    }
  }

  return { kind: 'stopped' };
}
