import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitFor } from '@zgeoff/testing/helpers';
import invariant from 'tiny-invariant';
import { buildDeploymentEnvironment } from '../src/test-utils/build-deployment-environment.ts';
import { readFreePort } from '../src/test-utils/read-free-port.ts';

// A second deployment beside the one the preload runs, on its own ports and store.
async function setupTest() {
  const hostBinary = process.env['PEPYS_HOST_BIN'];

  invariant(
    hostBinary !== undefined,
    'run the e2e lane with bun run test:e2e, which preloads packages/cli/e2e/start-stack.ts',
  );

  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-start-'));

  onTestFinished(() => rm(storeDirectory, { recursive: true, force: true }));

  return {
    runStart: (host: string) => {
      const child = Bun.spawn(
        [
          'bun',
          join(import.meta.dir, '../src/bin.ts'),
          'start',
          join(import.meta.dir, 'fixtures/e2e-deployment.ts'),
        ],
        {
          env: buildDeploymentEnvironment({
            base: process.env,
            hostBinary: host,
            ingestPort: readFreePort(),
            apiPort: readFreePort(),
            storeDirectory,
          }),
          stdout: 'pipe',
          stderr: 'pipe',
        },
      );

      onTestFinished(() => {
        child.kill('SIGKILL');
      });

      return child;
    },
    hostBinary,
  };
}

test('it exits 0 on SIGTERM once the host has stopped', async () => {
  const ctx = await setupTest();

  const start = ctx.runStart(ctx.hostBinary);
  const lines: string[] = [];

  // the host prints a line for each consumer it made current, the last of the e2e deployment's
  // being the ledger's, after ingest and the API listen
  const reading = (async () => {
    for await (const chunk of start.stdout) {
      lines.push(new TextDecoder().decode(chunk));
    }
  })();

  await waitFor(
    () => {
      expect(lines.join('')).toContain('ledger_account');

      return Promise.resolve();
    },
    { intervalMs: 100, timeoutMs: 30_000, label: 'the host to make the consumers current' },
  );

  start.kill('SIGTERM');

  const exitCode = await start.exited;

  await reading;

  expect(exitCode).toBe(0);
});
