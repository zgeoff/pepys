import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { stopProcessGroup } from '../../../scripts/utils/stop-process-group.ts';
import { buildDeploymentEnvironment } from '../src/test-utils/build-deployment-environment.ts';
import { readFreePort } from '../src/test-utils/read-free-port.ts';

async function setupTest() {
  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-start-'));

  onTestFinished(() => rm(storeDirectory, { recursive: true, force: true }));

  const falseBinary = Bun.which('false');

  invariant(falseBinary !== null, 'the machine has a false binary');

  return {
    runStart: async () => {
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
            hostBinary: falseBinary,
            ingestPort: readFreePort(),
            apiPort: readFreePort(),
            storeDirectory,
          }),
          stdout: 'ignore',
          stderr: 'pipe',
          detached: true,
        },
      );

      onTestFinished(() => stopProcessGroup(child));

      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);

      return { stderr, exitCode };
    },
  };
}

test('it stops ingest and the API and exits 1 when the host exits on its own', async () => {
  const ctx = await setupTest();
  const result = await ctx.runStart();

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('pepys start: host exited with 1');
});
