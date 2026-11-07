import { S2Error, SeqNumMismatchError } from '@s2-dev/streamstore';
import type { AppendOutcome } from '../fact-log.ts';

// A client error from the server means the record was not stored; 408 and 429 ask for a retry. A
// refusal the port has no reason for, such as a bad token, returns null for the caller to throw.
export function findAppendOutcome(error: unknown): AppendOutcome | null {
  if (error instanceof SeqNumMismatchError) {
    return { kind: 'rejected', reason: 'tail-mismatch' };
  }

  if (isUnknownStream(error)) {
    return { kind: 'rejected', reason: 'unknown-stream' };
  }

  if (isDefiniteRefusal(error)) {
    return null;
  }

  return { kind: 'unknown' };
}

export function isUnknownStream(error: unknown): boolean {
  return error instanceof S2Error && error.status === 404 && error.code === 'stream_not_found';
}

function isDefiniteRefusal(error: unknown): boolean {
  return (
    error instanceof S2Error &&
    error.origin === 'server' &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 408 &&
    error.status !== 429
  );
}
