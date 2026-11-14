import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { waitFor } from '@zgeoff/testing/helpers';
import { openSharedAuth } from '../../test-utils/open-shared-auth.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { startServiceTokenReloads } from './start-service-token-reloads.ts';

// An auth core that starts with one service client, `quay-reader`, and the reloads of a
// service-token file in the test's temp folder, stopped when the test finishes.
async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-service-token-reloads-');
  const filePath = join(temporaryDirectory.path, 'service-tokens.json');

  const auth = await openSharedAuth({
    origin: 'https://quay.example',
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    serviceTokens: {
      prefix: 'pepys_svc_',
      file: {
        resource: 'https://quay.example/mcp',
        clients: [
          {
            name: 'quay-reader',
            scopes: ['read'],
            tokens: ['pepys_svc_quayreaderquayreaderquayreader01'],
          },
        ],
      },
    },
  });

  const stop = startServiceTokenReloads(auth, filePath);

  onTestFinished(stop);

  return {
    stop,
    writeFile: (text: string) => Bun.write(filePath, text),
    verify: (bearer: string) => auth.verify(bearer),
  };
}

test('it reloads the service-token file when the process gets SIGHUP', async () => {
  const ctx = await setupTest();

  await ctx.writeFile(
    JSON.stringify({
      resource: 'https://quay.example/mcp',
      clients: {
        'dock-reader': { scopes: ['read'], tokens: ['pepys_svc_dockreaderdockreaderdockreader01'] },
      },
    }),
  );

  process.kill(process.pid, 'SIGHUP');

  await waitFor(async () => {
    const added = await ctx.verify('pepys_svc_dockreaderdockreaderdockreader01');

    expect(added).not.toBeNull();
  });

  const dropped = await ctx.verify('pepys_svc_quayreaderquayreaderquayreader01');

  expect(dropped).toBeNull();
});

test('it stops listening for SIGHUP at the stop', async () => {
  const listening = process.listenerCount('SIGHUP');

  const ctx = await setupTest();

  await ctx.stop();

  expect(process.listenerCount('SIGHUP')).toBe(listening);
});
