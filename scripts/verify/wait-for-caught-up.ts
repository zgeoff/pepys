import { createStoreReader } from '@pepys/api';
import { WringerError } from '@wringer/core';
import { waitFor } from '@zgeoff/testing/helpers';
import { readLaggingConsumers } from '../../packages/cli/src/test-utils/read-lagging-consumers.ts';
import { createControlClient } from './create-control-client.ts';
import type { RunEndpoints } from './parse-run-endpoints.ts';
import { verifyReadConsumers } from './verify-read-consumers.ts';

// Waits until each consumer a journey reads has applied every fact on its stream, so a query that
// follows sees them all. A stopped host never catches up, so it fails at once.
export async function waitForCaughtUp(run: RunEndpoints, timeoutMs: number) {
  const health = await createControlClient(run.control).health();

  if (health.host === 'stopped') {
    throw new WringerError('check-failed', {
      message: 'the host is stopped, so no consumer catches up',
      hint: 'Run `bun verify action start-host`, then this command again.',
    });
  }

  const store = createStoreReader({ storeDirectory: run.store });
  const s2 = { s2Endpoint: run.s2, s2AccessToken: run.s2Token, s2Basin: run.s2Basin };
  const startedAt = performance.now();

  try {
    await waitFor(
      async () => {
        const lagging = await readLaggingConsumers(store, s2, verifyReadConsumers);

        if (lagging.length > 0) {
          throw new Error(`still behind: ${lagging.join(', ')}`);
        }
      },
      { intervalMs: 200, timeoutMs, label: 'every consumer to catch up' },
    );
  } catch (error) {
    throw new WringerError('check-failed', { message: String(error) });
  } finally {
    await store.close();
  }

  return {
    consumers: verifyReadConsumers.map((entry) => entry.consumer.name),
    waitedMs: Math.round(performance.now() - startedAt),
  };
}
