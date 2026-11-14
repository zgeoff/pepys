import { createStoreReader, readOffsets } from '@pepys/api';
import { WringerError } from '@wringer/core';
import { waitFor } from '@zgeoff/testing/helpers';
import { readLaggingConsumers } from '../../../packages/cli/e2e/fixtures/read-lagging-consumers.ts';
import { createControlClient } from '../create-control-client.ts';
import type { RunEndpoints } from '../parse-run-endpoints.ts';
import { verifyReadConsumers } from '../verify-read-consumers.ts';

// The doctor's host check: the host runs, `run --up` has deployed a current version of each
// consumer a journey reads, and each has applied its stream, the ledger journey included.
export async function checkHost(run: RunEndpoints, timeoutMs: number) {
  const health = await createControlClient(run.control).health();

  if (health.host !== 'running') {
    throw new WringerError('check-failed', {
      message: 'the host is stopped',
      hint: 'Run `bun verify action start-host`, then `bun verify doctor`.',
    });
  }

  const store = createStoreReader({ storeDirectory: run.store });
  const s2 = { s2Endpoint: run.s2, s2AccessToken: run.s2Token, s2Basin: run.s2Basin };

  try {
    await waitFor(
      async () => {
        for (const entry of verifyReadConsumers) {
          const offsets = await readOffsets(store, entry.consumer);

          if (!offsets.ok) {
            throw new Error(`${entry.consumer.name} has no current version`);
          }
        }

        const lagging = await readLaggingConsumers(store, s2, verifyReadConsumers);

        if (lagging.length > 0) {
          throw new Error(`still behind: ${lagging.join(', ')}`);
        }
      },
      { intervalMs: 250, timeoutMs, label: 'the host to deploy and catch up' },
    );
  } catch (error) {
    throw new WringerError('check-failed', {
      message: String(error),
      hint: 'Read the `host` stream with `bun verify stream read host`.',
    });
  } finally {
    await store.close();
  }

  return { host: health.host, starts: health.starts };
}
