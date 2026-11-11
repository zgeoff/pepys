import type { ApplyFailure } from './types.ts';

// What `apply` throws when it refuses a batch. The batch then wrote nothing.
export class ApplyError extends Error {
  readonly failure: ApplyFailure;

  constructor(failure: ApplyFailure) {
    super(`the test store refused the batch: ${JSON.stringify(failure)}`);

    this.name = 'ApplyError';
    this.failure = failure;
  }
}
