import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { S2 } from '@s2-dev/streamstore';
import invariant from 'tiny-invariant';
import { stopProcessGroup } from '../../../scripts/utils/stop-process-group.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-serve-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const endpoint = process.env['PEPYS_S2_ENDPOINT'];
  const accessToken = process.env['PEPYS_S2_ACCESS_TOKEN'];

  invariant(
    endpoint !== undefined && accessToken !== undefined,
    'the e2e preload sets the s2 address',
  );

  const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: () => {} } });
  const port = listener.port;

  listener.stop(true);

  return {
    folder,

    // every variable that a start on the basin needs, with a port that was free a moment ago
    buildStartEnvironment: (basin: string): Record<string, string> => ({
      PEPYS_S2_ENDPOINT: endpoint,
      PEPYS_S2_ACCESS_TOKEN: accessToken,
      PEPYS_S2_BASIN: basin,
      PEPYS_INGEST_PORT: String(port),
      LEDGER_SECRET: 'till-secret',
      BEACON_TOKEN: 'harbour-key',
      STRAY_TOKEN: 'stray-key',
    }),
    readStreamConfig: (basin: string, stream: string) =>
      new S2({ accessToken, endpoints: { account: endpoint, basin: endpoint } })
        .basin(basin)
        .streams.getConfig({ stream }),
    runServeIngest: async (environment: Record<string, string>) => {
      // The whole environment of the run, so a variable of the e2e stack never fills a gap.
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, 'fixtures/serve-stub-ingest.ts')],
        { env: environment, stdout: 'pipe', stderr: 'pipe', detached: true },
      );

      onTestFinished(() => stopProcessGroup(child));

      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);

      return {
        exitCode,
        printed: stdout.split('\n').filter((line) => line !== ''),
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
    printed: [],
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
    printed: [],
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
    printed: [],
    logged: [
      {
        level: 'error',
        message: 'the sender proof cannot start',
        detail: expect.stringMatching(/^BEACON_ISSUERS: /u),
      },
    ],
  });
});

test('it creates the cursor stream with infinite retention at start', async () => {
  const ctx = await setupTest();

  await ctx.runServeIngest(ctx.buildStartEnvironment('serve-cursor-stream'));

  const config = await ctx.readStreamConfig('serve-cursor-stream', 'facts.cursors');

  expect(config.retentionPolicy).toStrictEqual({ infinite: {} });
});

test('it starts a timed pull from no cursor on a new basin, and prints so', async () => {
  const ctx = await setupTest();

  const run = await ctx.runServeIngest({
    ...ctx.buildStartEnvironment('serve-first-start'),
    STUB_PLUGINS: 'timed-pull',
  });

  expect({ exitCode: run.exitCode, logged: run.logged }).toStrictEqual({ exitCode: 0, logged: [] });

  expect(run.printed).toContain(
    'pull almanac live {"source":"almanac","path":"live","cursor":"none"}',
  );
});

test('it starts a timed pull from the cursor that the start before it saved, and prints so', async () => {
  const ctx = await setupTest();

  const environment = {
    ...ctx.buildStartEnvironment('serve-second-start'),
    STUB_PLUGINS: 'timed-pull',
  };

  await ctx.runServeIngest(environment);

  const run = await ctx.runServeIngest(environment);

  expect({ exitCode: run.exitCode, logged: run.logged }).toStrictEqual({ exitCode: 0, logged: [] });

  expect(run.printed).toContain(
    'pull almanac live {"source":"almanac","path":"live","cursor":"saved"}',
  );
});
