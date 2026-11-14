import { ORPCError } from '@orpc/client';
import { WringerError } from '@wringer/core';
import type { HttpClient } from '@wringer/http';
import { createAPIClient } from '../create-api-client.ts';

// The doctor's API check: `get_entity` answers NOT_FOUND for a pull request that no fact names.
export async function checkAPI(http: HttpClient): Promise<{ answered: string }> {
  const api = createAPIClient(http);

  try {
    await api.get_entity({ id: 'github:pull_request:1' });
  } catch (error) {
    if (error instanceof ORPCError && error.code === 'NOT_FOUND') {
      return { answered: 'NOT_FOUND' };
    }

    throw new WringerError('check-failed', {
      message: `the API failed get_entity: ${String(error)}`,
      hint: 'Run `bun verify up --restart`, then `bun verify doctor`.',
    });
  }

  throw new WringerError('check-failed', {
    message: 'the API found github:pull_request:1, which no fact names',
  });
}
