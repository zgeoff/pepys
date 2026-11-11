import type { Pulled } from '@pepys/kit';

const retryAfterMs = 60_000;

// What a pull answers for an API status that stopped it. A 401 means the App's credentials are
// wrong, and no retry mends that; any other status, or 0 for a transport failure, may pass.
export function pickPullFailure(status: number): Pulled {
  return status === 401
    ? { kind: 'rejected', reason: 'GitHub refused the App token' }
    : { kind: 'unavailable', retryAfterMs };
}
