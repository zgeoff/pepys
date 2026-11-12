import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-serve-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const script = [
    `import { serveIngest } from ${JSON.stringify(join(import.meta.dir, 'serve-ingest.ts'))};`,
    `import { buildStubReceiveDeployment } from ${JSON.stringify(join(import.meta.dir, '../test-utils/build-stub-receive-deployment.ts'))};`,
    'const definition = buildStubReceiveDeployment().definition;',
    "const plugins = process.env['STUB_PLUGINS'] === 'twice' ? [...definition.plugins, ...definition.plugins] : definition.plugins;",
    'await serveIngest({ deployment: { ...definition, plugins }, environment: process.env });',
  ].join('\n');

  return {
    folder,
    runServeIngest: async (environment: Record<string, string>) => {
      const child = Bun.spawn([process.execPath, '--eval', script], {
        env: environment,
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);

      return {
        exitCode,
        logged: stderr
          .split('\n')
          .filter((line) => line !== '')
          .map((line): unknown => JSON.parse(line)),
      };
    },
  };
}

test('it exits 1 and logs the faults of a deployment that lists each plug-in twice', async () => {
  const ctx = await setupTest();
  const run = await ctx.runServeIngest({ STUB_PLUGINS: 'twice' });

  expect(run).toStrictEqual({
    exitCode: 1,
    logged: [
      {
        level: 'error',
        message: 'the deployment fails its check',
        detail: expect.arrayContaining([
          {
            kind: 'duplicate',
            of: 'stream',
            name: 'facts.ledger.till',
            plugins: ['ledger', 'ledger'],
          },
        ]),
      },
    ],
  });
});

test('it exits 1 and logs every missing variable when the config is incomplete', async () => {
  const ctx = await setupTest();
  const run = await ctx.runServeIngest({ PEPYS_S2_ENDPOINT: 'http://127.0.0.1:1' });

  expect(run).toStrictEqual({
    exitCode: 1,
    logged: [
      {
        level: 'error',
        message: 'the ingest config is incomplete',
        detail: [
          'PEPYS_S2_ACCESS_TOKEN is not set',
          'PEPYS_S2_BASIN is not set',
          'LEDGER_SECRET is not set',
          'BEACON_TOKEN is not set',
          'STRAY_TOKEN is not set',
        ],
      },
    ],
  });
});

test('it exits 1 and logs the cause when the trust folder of a sender proof cannot be read', async () => {
  const ctx = await setupTest();

  const run = await ctx.runServeIngest({
    PEPYS_S2_ENDPOINT: 'http://127.0.0.1:1',
    PEPYS_S2_ACCESS_TOKEN: 'quay-token',
    PEPYS_S2_BASIN: 'quay',
    LEDGER_SECRET: 'till-secret',
    BEACON_TOKEN: 'harbour-key',
    STRAY_TOKEN: 'stray-key',
    BEACON_AUDIENCE: 'pepys-ingest',
    BEACON_ISSUERS: join(ctx.folder, 'missing'),
  });

  expect(run).toStrictEqual({
    exitCode: 1,
    logged: [
      {
        level: 'error',
        message: 'the sender proof cannot start',
        detail: expect.stringMatching(/^BEACON_ISSUERS: /u),
      },
    ],
  });
});
