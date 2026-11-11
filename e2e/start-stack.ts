// `test:e2e` preloads this setup, which starts the GitHub pull request path once for the whole
// lane, so each test's 15 s limit covers its own act and not the container start. Test files may
// not hold beforeAll, and the tests read what it started through the environment.

import { afterAll, beforeAll } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Webhooks } from '@octokit/webhooks';
import { createStoreReader, openConsumerDatabase, readOffsets } from '@pepys/api';
import { consumerBuildManifestSchema } from '@pepys/schema';
import { S2 } from '@s2-dev/streamstore';
import { stopProcessGroup } from '../scripts/utils/stop-process-group.ts';
import { buildStackEnv } from '../stack/build-stack-env.ts';
import { withStack } from '../stack/with-stack.ts';
import type { RunningStack } from '../stack/with-stack.ts';

const root = join(import.meta.dir, '..');
const consumerName = 'github_pull_request';
const streamName = 'facts.github.pull_request';
const webhookSecret = 'github-pr-webhook-secret';
const host = join(root, 'target/debug/pepys');
const consumersPath = join(root, 'build/consumers/consumers.json');

// closes what the setup started in the reverse order, and runs every step even when one throws
const cleanup = new AsyncDisposableStack();

const testsDone = Promise.withResolvers<void>();

beforeAll(
  async () => {
    await checkBuilt();

    const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-e2e-'));

    cleanup.defer(() => rm(storeDirectory, { recursive: true, force: true }));

    const stack = await startStack();

    Object.assign(process.env, {
      ...buildStackEnv(stack),
      PEPYS_STORE_DIR: storeDirectory,
      PEPYS_CONSUMERS: consumersPath,
    });

    await runSlice({ stack, storeDirectory });

    process.env['PEPYS_E2E_API_URL'] = await startAPI(stack.stop);
  },

  // a fresh runner pulls the Garage and s2-lite images before the stack starts
  { timeout: 300_000 },
);

afterAll(() => cleanup.disposeAsync());

// the host reads consumers.json and each module it lists, which the last
// `bun run consumers:build` wrote
async function checkBuilt(): Promise<void> {
  if (!existsSync(host) || !existsSync(consumersPath)) {
    throw new Error('build the host and the consumers first: bun run test:e2e:prepare');
  }

  const text: unknown = await Bun.file(consumersPath).json();

  const listed = consumerBuildManifestSchema
    .parse(text)
    .consumers.some((consumer) => consumer.name === consumerName);

  if (!listed) {
    throw new Error(`consumers.json lists no ${consumerName}: bun run test:e2e:prepare`);
  }
}

// withStack removes the compose project when its callback returns, so the callback holds the stack
// open until the last test ends
async function startStack(): Promise<RunningStack> {
  const stackReady = Promise.withResolvers<RunningStack>();

  const run = withStack(async (stack) => {
    stackReady.resolve(stack);

    await testsDone.promise;
  });

  cleanup.defer(async () => {
    testsDone.resolve();

    await run;
  });

  const stack = await Promise.race([stackReady.promise, waitForStackEnd(run)]);

  if (stack === null) {
    throw new Error('the stack stopped before the tests started');
  }

  return stack;
}

async function waitForStackEnd(run: Promise<void>): Promise<null> {
  await run;

  return null;
}

interface SliceOptions {
  stack: RunningStack;
  storeDirectory: string;
}

async function runSlice(options: SliceOptions): Promise<void> {
  const ingestPort = readFreePort();

  runChild(['bun', 'packages/source-github/src/ingest/serve-ingest.ts'], {
    ...process.env,
    PEPYS_INGEST_PORT: String(ingestPort),
    PEPYS_GITHUB_WEBHOOK_SECRET: webhookSecret,
  });

  const webhookURL = `http://127.0.0.1:${ingestPort}/webhook`;

  await waitForIngest(webhookURL, options.stack.stop);
  await runHost(['up']);

  const opened = buildDelivery({
    deliveryID: 'github-pr-delivery-1',
    action: 'opened',
    title: 'Add the harbour map',
    updatedAt: '2026-10-01T09:00:00Z',
  });

  const synchronized = buildDelivery({
    deliveryID: 'github-pr-delivery-2',
    action: 'synchronize',
    title: 'Add the harbour map and tides',
    updatedAt: '2026-10-01T10:00:00Z',
  });

  const outOfOrder = buildDelivery({
    deliveryID: 'github-pr-delivery-3',
    action: 'edited',
    title: 'An older title',
    updatedAt: '2026-10-01T09:30:00Z',
  });

  for (const delivery of [opened, synchronized, opened, outOfOrder]) {
    await writeDelivery(webhookURL, delivery);
  }

  const tail = await readTail(options.stack);

  await runUntilCaughtUp(options.storeDirectory, tail, options.stack.stop);
}

// each child leads its own process group, so cleanup also stops anything the child forked
function runChild(command: string[], env: Record<string, string | undefined>): Bun.Subprocess {
  const child = Bun.spawn(command, {
    cwd: root,
    env,
    stdout: 'inherit',
    stderr: 'inherit',
    detached: true,
  });

  cleanup.defer(() => stopProcessGroup(child));

  return child;
}

async function runHost(args: string[]): Promise<void> {
  const child = runChild([host, ...args], process.env);

  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(`pepys ${args.join(' ')} exited with ${exitCode}`);
  }
}

interface Delivery {
  deliveryID: string;
  body: string;
}

interface DeliveryParameters {
  deliveryID: string;
  action: string;
  title: string;
  updatedAt: string;
}

function buildDelivery(parameters: DeliveryParameters): Delivery {
  const body = JSON.stringify({
    action: parameters.action,
    number: 12,
    pull_request: {
      id: 1_874_433_021,
      number: 12,
      title: parameters.title,
      state: 'open',
      draft: false,
      merged: false,
      merge_commit_sha: null,
      html_url: 'https://github.example/acme/harbour/pull/12',
      user: { id: 4401 },
      base: { repo: { id: 902 } },
      created_at: '2026-10-01T08:00:00Z',
      updated_at: parameters.updatedAt,
      closed_at: null,
      merged_at: null,
    },
    sender: { id: 4401 },
  });

  return { deliveryID: parameters.deliveryID, body };
}

async function writeDelivery(url: string, delivery: Delivery): Promise<void> {
  const signature = await new Webhooks({ secret: webhookSecret }).sign(delivery.body);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'x-hub-signature-256': signature,
      'x-github-event': 'pull_request',
      'x-github-delivery': delivery.deliveryID,
    },
    body: delivery.body,
  });

  if (response.status !== 200) {
    throw new Error(`ingest answered ${response.status} to ${delivery.deliveryID}`);
  }
}

const startDeadlineMs = 30_000;

async function waitForIngest(url: string, stop: AbortSignal): Promise<void> {
  const deadline = Date.now() + startDeadlineMs;

  while (Date.now() < deadline) {
    stop.throwIfAborted();

    const response = await fetch(url, { method: 'POST' }).catch(() => null);

    if (response?.status === 401) {
      return;
    }

    await Bun.sleep(100);
  }

  throw new Error('ingest did not answer before the deadline');
}

async function readTail(stack: RunningStack): Promise<number> {
  const client = new S2({
    accessToken: stack.s2AccessToken,
    endpoints: { account: stack.s2Endpoint, basin: stack.s2Endpoint },
  });

  const response = await client.basin(stack.s2Basin).stream(streamName).checkTail();

  return response.tail.seqNum;
}

async function runUntilCaughtUp(
  storeDirectory: string,
  tail: number,
  stop: AbortSignal,
): Promise<void> {
  const run = runChild([host, 'run'], process.env);
  const store = createStoreReader({ storeDirectory, openDatabase: openConsumerDatabase });
  const deadline = Date.now() + 60_000;

  try {
    while (Date.now() < deadline) {
      stop.throwIfAborted();

      const offsets = await readOffsets(store, consumerName);

      if (offsets.ok && offsets.value.some((offset) => offset.lastSeqNum === tail - 1)) {
        return;
      }

      await Bun.sleep(200);
    }

    throw new Error('pepys run did not catch up before the deadline');
  } finally {
    await store.close();

    await stopProcessGroup(run);
  }
}

async function startAPI(stop: AbortSignal): Promise<string> {
  const apiPort = readFreePort();

  runChild(['bun', 'packages/source-github/src/api/serve-api.ts'], {
    ...process.env,
    PEPYS_API_PORT: String(apiPort),
  });

  const rpcURL = `http://127.0.0.1:${apiPort}/rpc`;
  const deadline = Date.now() + startDeadlineMs;

  while (Date.now() < deadline) {
    stop.throwIfAborted();

    const response = await fetch(rpcURL).catch(() => null);

    if (response !== null) {
      return rpcURL;
    }

    await Bun.sleep(100);
  }

  throw new Error('the API did not answer before the deadline');
}

function readFreePort(): number {
  const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: () => {} } });
  const port = listener.port;

  listener.stop(true);

  return port;
}
