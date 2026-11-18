import { expect, onTestFinished, test } from 'bun:test';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogger } from '@pepys/kit';
import invariant from 'tiny-invariant';
import { createIdentity } from './identity/create-identity.ts';
import { runForwarder } from './run-forwarder.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-run-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const probe = createServer();

  await once(probe.listen(0, '127.0.0.1'), 'listening');

  const address = probe.address();

  invariant(typeof address === 'object' && address !== null, 'the probe listens on a port');

  const port = address.port;

  probe.close();

  await once(probe, 'close');

  const stop = new AbortController();

  const lines: string[] = [];

  onTestFinished(() => stop.abort());

  const environment = {
    PEPYS_FORWARDER_PORT: String(port),
    PEPYS_FORWARDER_SPOOL_DIR: join(folder, 'spool'),
    PEPYS_FORWARDER_IDENTITY_DIR: join(folder, 'identity'),
  };

  return {
    folder,
    environment,
    lines,
    stop,
    url: `http://127.0.0.1:${port}`,
    run: (extra: Record<string, string>) =>
      runForwarder({
        environment: { ...environment, ...extra },
        logger: createLogger({ write: (line) => lines.push(line) }),
        signal: stop.signal,
      }),
    waitForServer: async (url: string) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const answer = await fetch(`${url}/health`).catch(() => null);

        if (answer !== null) {
          return;
        }

        await Bun.sleep(10);
      }
    },
    readSpoolNames: async () => {
      const names = await readdir(environment.PEPYS_FORWARDER_SPOOL_DIR);

      return names.toSorted();
    },
  };
}

test('it receives an export and answers GET /health with send off when no ingest URL is set, then stops on the signal', async () => {
  const ctx = await setupTest();

  const running = ctx.run({});

  await ctx.waitForServer(ctx.url);

  const exported = await fetch(`${ctx.url}/v1/logs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'user-agent': 'codex/1.0' },
    body: '{"resourceLogs":[]}',
  });

  const health = await fetch(`${ctx.url}/health`);
  const names = await ctx.readSpoolNames();

  const text = await readFile(
    join(ctx.environment.PEPYS_FORWARDER_SPOOL_DIR, names[0] ?? ''),
    'utf8',
  );

  ctx.stop.abort();

  expect({
    export: [exported.status, await exported.json()],
    health: [health.status, await health.json()],
    names: names.map((name) => name.endsWith('-logs.jsonl')),
    ua: JSON.parse(text).ua,
    exitCode: await running,
  }).toStrictEqual({
    export: [200, {}],
    health: [200, { send: 'off', failed: 0 }],
    names: [true],
    ua: 'codex/1.0',
    exitCode: 0,
  });
});

test('it exits 1 at start with an ingest URL and no key or machine ID', async () => {
  const ctx = await setupTest();

  const exitCode = await ctx.run({
    PEPYS_FORWARDER_INGEST_URL: 'https://ingest.tailnet.example',
    PEPYS_FORWARDER_ISSUER: 'study-pc',
    PEPYS_FORWARDER_AUDIENCE: 'forwarder.pepys.example',
  });

  expect({
    exitCode,
    logged: ctx.lines.some((line) => line.includes('cannot start')),
  }).toStrictEqual({
    exitCode: 1,
    logged: true,
  });
});

test('it exits 1 at start with an ingest URL and no audience', async () => {
  const ctx = await setupTest();

  const exitCode = await ctx.run({
    PEPYS_FORWARDER_INGEST_URL: 'https://ingest.tailnet.example',
    PEPYS_FORWARDER_ISSUER: 'study-pc',
  });

  expect(exitCode).toBe(1);
});

test('it starts the send loop with an ingest URL and an identity, and sends a stored export to the route', async () => {
  const ctx = await setupTest();

  const received: { url: string; token: string | null }[] = [];
  const arrived = Promise.withResolvers<void>();

  const ingest = Bun.serve({
    port: 0,
    routes: {
      '/forwarded/v1/logs': {
        POST: (request) => {
          received.push({
            url: new URL(request.url).pathname,
            token: request.headers.get('imp-identity'),
          });

          arrived.resolve();

          return Response.json({});
        },
      },
    },
  });

  onTestFinished(async () => {
    await ingest.stop(true);
  });

  await createIdentity({
    folder: ctx.environment.PEPYS_FORWARDER_IDENTITY_DIR,
    issuer: 'study-pc',
    randomID: () => 'id-1',
  });

  const running = ctx.run({
    PEPYS_FORWARDER_INGEST_URL: `http://127.0.0.1:${ingest.port}`,
    PEPYS_FORWARDER_ISSUER: 'study-pc',
    PEPYS_FORWARDER_AUDIENCE: 'forwarder.pepys.example',
  });

  await ctx.waitForServer(ctx.url);

  await fetch(`${ctx.url}/v1/logs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"resourceLogs":[]}',
  });

  await arrived.promise;

  ctx.stop.abort();

  await running;

  expect(received.map((request) => request.url)).toStrictEqual(['/forwarded/v1/logs']);
  expect(received[0]?.token).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/u);
});
