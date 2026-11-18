export const initialRetryWaitMs = 1000;
export const maxRetryWaitMs = 300_000;
export const slowRetryWaitMs = 900_000;
export const maxServerErrorTries = 4;

export interface AnswerAction {
  // sent: the position moves past the line. failed: the line goes to `failed`, then the position
  // moves. stay: the line stays in the spool.
  move: 'sent' | 'failed' | 'stay';
  state: 'sending' | 'waiting' | 'stopped';

  // none: the next request follows at once. backoff: the retry wait. slow: 15 minutes.
  wait: 'none' | 'backoff' | 'slow';
  serverErrors: number;
}

const refusedForGood = new Set([400, 413, 415, 422]);
const refusedForNow = new Set([401, 403, 404]);

// The row of the answer table that fits an answer. A null status is a timeout or no connection.
// `serverErrors` is the count of 500 answers that the line has had so far.
export function pickAnswerAction(status: number | null, serverErrors: number): AnswerAction {
  if (status !== null && status >= 200 && status < 300) {
    return { move: 'sent', state: 'sending', wait: 'none', serverErrors: 0 };
  }

  if (status !== null && refusedForGood.has(status)) {
    return { move: 'failed', state: 'sending', wait: 'none', serverErrors: 0 };
  }

  if (status === 500) {
    const count = serverErrors + 1;

    return count >= maxServerErrorTries
      ? { move: 'failed', state: 'stopped', wait: 'none', serverErrors: 0 }
      : { move: 'stay', state: 'stopped', wait: 'slow', serverErrors: count };
  }

  if (status !== null && refusedForNow.has(status)) {
    return { move: 'stay', state: 'stopped', wait: 'slow', serverErrors };
  }

  return { move: 'stay', state: 'waiting', wait: 'backoff', serverErrors };
}

export function pickNextRetryWait(waitMs: number): number {
  return Math.min(waitMs * 2, maxRetryWaitMs);
}
