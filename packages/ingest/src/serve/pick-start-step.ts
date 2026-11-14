import { S2Error } from '@s2-dev/streamstore';
import { isDefiniteRefusal } from '../fact-log/s2/find-append-outcome.ts';

export type StartStep = { kind: 'retry'; delayMs: number } | { kind: 'stop' };

const firstDelayMs = 200;
const maxDelayMs = 30_000;

// the failures in a row after which the start ends, as the host's `up` does
export const startRetryLimit = 10;

// What the start does after the fact log failed it `failures` times in a row. A failure that a later
// try can pass, such as a refused connection or a 5xx, waits a delay that doubles from 200 ms up to
// 30 s. A refusal of the request itself, such as a bad token, fails the same way each time.
export function pickStartStep(error: unknown, failures: number): StartStep {
  const canPass = error instanceof S2Error && !isDefiniteRefusal(error);

  if (!canPass || failures >= startRetryLimit) {
    return { kind: 'stop' };
  }

  return { kind: 'retry', delayMs: Math.min(firstDelayMs * 2 ** (failures - 1), maxDelayMs) };
}
