// `test:e2e` preloads this setup. It starts the e2e deployment with `pepys start` and sends each fact
// once for the whole lane, so each test's 15 s limit covers its own act and not the container start. Test files may
// not hold beforeAll, and the tests read what it started through the environment.

import { afterAll, beforeAll } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStoreReader } from '@pepys/api';
import { createFactBatchSender } from '@pepys/kit/send';
import { waitFor } from '@zgeoff/testing/helpers';
import { logbookSource } from 'logbook-plugin';
import { stopProcessGroup } from '../../../scripts/utils/stop-process-group.ts';
import type { RunningStack } from '../../../stack/with-stack.ts';
import type { IdentityIssuer } from '../../ingest/src/sender-proof/imp-identity/test-utils/create-identity-issuer.ts';
import { buildGithubDelivery } from './fixtures/build-github-delivery.ts';
import { e2eReadConsumers } from './fixtures/e2e-read-consumers.ts';
import { e2eSecrets } from './fixtures/e2e-secrets.ts';
import { readLaggingConsumers } from './fixtures/read-lagging-consumers.ts';
import { startE2EStack } from './fixtures/start-e2e-stack.ts';
import { writeGithubDelivery } from './fixtures/write-github-delivery.ts';

const root = join(import.meta.dir, '../../..');
const cliPath = join(root, 'packages/cli/src/bin.ts');
const deploymentPath = join(import.meta.dir, 'fixtures/e2e-deployment.ts');

// closes what the setup started in the reverse order, and runs every step even when one throws
const cleanup = new AsyncDisposableStack();

beforeAll(
  async () => {
    const started = await startE2EStack(cleanup);

    Object.assign(process.env, {
      ...started.environment,
      PEPYS_E2E_INGEST_URL: started.ingestURL,
      PEPYS_E2E_API_URL: `${started.apiURL}/rpc`,
    });

    const runDirectory = await mkdtemp(join(tmpdir(), 'pepys-e2e-run-'));

    cleanup.defer(() => rm(runDirectory, { recursive: true, force: true }));

    const runStderrPath = join(runDirectory, 'stderr.txt');

    await runDeployment({
      stack: started.stack,
      storeDirectory: started.storeDirectory,
      issuer: started.issuer,
      environment: started.environment,
      ingestURL: started.ingestURL,
      apiURL: `${started.apiURL}/rpc`,
      runStderrPath,
    });

    process.env['PEPYS_E2E_RUN_STDERR'] = runStderrPath;
  },

  // a fresh runner pulls the Garage and s2-lite images before the stack starts
  { timeout: 300_000 },
);

afterAll(() => cleanup.disposeAsync());

interface DeploymentOptions {
  stack: RunningStack;
  storeDirectory: string;
  issuer: IdentityIssuer;
  environment: Record<string, string | undefined>;
  ingestURL: string;
  apiURL: string;
  runStderrPath: string;
}

// Starts the deployment with `pepys start`, sends every fact, and waits until the host has applied
// them. Ingest and the API keep running for the tests.
async function runDeployment(options: DeploymentOptions): Promise<void> {
  const hostErrors: HostErrors = { text: '' };

  // cleanup runs in reverse, so this waits for the end of stderr after the process group stops
  let reading: Promise<void> = Promise.resolve();

  cleanup.defer(() => reading);

  const start = runChild(['bun', cliPath, 'start', deploymentPath], options.environment);

  reading = readHostErrors(start.stderr, hostErrors);

  const webhookURL = `${options.ingestURL}/webhook/github`;

  await waitForIngest(webhookURL, options.stack.stop, start);

  const opened = buildGithubDelivery({
    deliveryID: 'github-pr-delivery-1',
    action: 'opened',
    title: 'Add the harbour map',
    updatedAt: '2026-10-01T09:00:00Z',
  });

  const synchronized = buildGithubDelivery({
    deliveryID: 'github-pr-delivery-2',
    action: 'synchronize',
    title: 'Add the harbour map and tides',
    updatedAt: '2026-10-01T10:00:00Z',
  });

  const outOfOrder = buildGithubDelivery({
    deliveryID: 'github-pr-delivery-3',
    action: 'edited',
    title: 'An older title',
    updatedAt: '2026-10-01T09:30:00Z',
  });

  for (const delivery of [opened, synchronized, opened, outOfOrder]) {
    await writeGithubDelivery(webhookURL, delivery);
  }

  await writeVoyages(`${options.ingestURL}/logbook/facts`);
  await writeLogs(`${options.ingestURL}/v1/logs`, options.issuer);

  await waitUntilCaughtUp({
    storeDirectory: options.storeDirectory,
    stack: options.stack,
    stop: options.stack.stop,
    start,
    hostErrors,
    runStderrPath: options.runStderrPath,
  });

  await waitForAPI(options.apiURL, options.stack.stop, start);
}

// The child leads its own process group, so cleanup also stops the host that it spawned. Its stderr
// is piped, because the host prints each error of `run` there and the lane keeps those lines.
function runChild(
  command: string[],
  env: Record<string, string | undefined>,
): Bun.Subprocess<'ignore', 'inherit', 'pipe'> {
  const child = Bun.spawn(command, {
    cwd: root,
    env,
    stdout: 'inherit',
    stderr: 'pipe',
    detached: true,
  });

  cleanup.defer(() => stopProcessGroup(child));

  return child;
}

// Two voyages in one harbour, one of which cites the pull request, and one in another harbour.
async function writeVoyages(url: string): Promise<void> {
  const send = createFactBatchSender({ source: logbookSource, url, secret: e2eSecrets.logbook });

  const sent = await send([
    {
      type: 'logbook.voyage.logged',
      event: 'voyage-1',
      entity: 'logbook:voyage:v-1',
      at: '2026-10-02T07:00:00Z',
      payload: { title: 'Charting the harbour reef', harbour: 'Port Coral', cites: 1_874_433_021 },
    },
    {
      type: 'logbook.voyage.logged',
      event: 'voyage-2',
      entity: 'logbook:voyage:v-2',
      at: '2026-10-03T07:00:00Z',
      payload: { title: 'Sounding the north channel', harbour: 'Port Coral' },
    },
    {
      type: 'logbook.voyage.logged',
      event: 'voyage-3',
      entity: 'logbook:voyage:v-3',
      at: '2026-10-02T09:00:00Z',
      payload: { title: 'Resupply run', harbour: 'Gull Island' },
    },
  ]);

  if (!sent.ok) {
    throw new Error(`ingest refused the logbook batch: ${JSON.stringify(sent.failure)}`);
  }
}

// One export of one model request, with the bearer secret and an identity token of the trusted
// issuer, signed just before the send because a token lives 55 s at most.
async function writeLogs(url: string, issuer: IdentityIssuer): Promise<void> {
  const nowSeconds = Math.floor(Date.now() / 1000);

  const token = await issuer.signToken({
    audience: e2eSecrets.identityAudience,
    subject: 'imp-7731',
    name: 'imp-harbour',
    issuedAtSeconds: nowSeconds,
    expiresAtSeconds: nowSeconds + 50,
  });

  // OTLP JSON as Claude Code's exporter writes it: an integer is a JSON number
  const body = {
    resourceLogs: [
      {
        resource: { attributes: [{ key: 'atc.session.id', value: { stringValue: 's-harbour' } }] },
        scopeLogs: [
          {
            scope: { name: 'com.anthropic.claude_code.events' },
            logRecords: [
              {
                timeUnixNano: '1794370800000000000',
                observedTimeUnixNano: '1794370800500000000',
                body: { stringValue: 'claude_code.api_request' },
                attributes: [
                  { key: 'event.name', value: { stringValue: 'api_request' } },
                  { key: 'session.id', value: { stringValue: 'c-harbour' } },
                  { key: 'event.timestamp', value: { stringValue: '2026-11-11T02:20:00.000Z' } },
                  { key: 'request_id', value: { stringValue: 'req_harbour_01' } },
                  { key: 'model', value: { stringValue: 'model-large' } },
                  { key: 'cost_usd', value: { doubleValue: 0.4 } },
                  { key: 'input_tokens', value: { intValue: 12 } },
                  { key: 'cache_read_tokens', value: { intValue: 900 } },
                  { key: 'cache_creation_tokens', value: { intValue: 30 } },
                  { key: 'output_tokens', value: { intValue: 210 } },
                  { key: 'duration_ms', value: { intValue: 4100 } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${e2eSecrets.telemetry}`,
      'imp-identity': token,
    },
    body: JSON.stringify(body),
  });

  if (response.status !== 200) {
    throw new Error(
      `ingest answered ${response.status} to the logs export: ${await response.text()}`,
    );
  }
}

const startDeadlineMs = 30_000;

async function waitForIngest(url: string, stop: AbortSignal, start: Bun.Subprocess): Promise<void> {
  await waitFor(
    async () => {
      if (stop.aborted) {
        return;
      }

      throwIfStartEnded(start);

      const response = await fetch(url, { method: 'POST' });

      if (response.status !== 401) {
        throw new Error(`ingest answered ${response.status}, not 401`);
      }
    },
    { intervalMs: 100, timeoutMs: startDeadlineMs, label: 'ingest' },
  );

  stop.throwIfAborted();
}

interface CaughtUpOptions {
  storeDirectory: string;
  stack: RunningStack;
  stop: AbortSignal;
  start: Bun.Subprocess;
  hostErrors: HostErrors;
  runStderrPath: string;
}

function throwIfStartEnded(start: Bun.Subprocess): void {
  if (start.exitCode !== null) {
    throw new Error(`pepys start exited with ${start.exitCode}`);
  }
}

// The host keeps running for the tests, so this keeps the errors it has printed by the time every
// consumer has caught up.
async function waitUntilCaughtUp(options: CaughtUpOptions): Promise<void> {
  const store = createStoreReader({ storeDirectory: options.storeDirectory });

  // a stopped task never catches up, so the wait ends at the first error, which a test reports
  const failure = await waitFor(
    async () => {
      if (options.stop.aborted || hasHostError(options.hostErrors.text)) {
        return;
      }

      throwIfStartEnded(options.start);

      const lagging = await readLaggingConsumers(store, options.stack, e2eReadConsumers);

      if (lagging.length > 0) {
        throw new Error(`still behind: ${lagging.join(', ')}`);
      }
    },
    { intervalMs: 200, timeoutMs: 60_000, label: 'pepys start to catch up' },
  ).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );

  await store.close();
  await Bun.write(options.runStderrPath, options.hostErrors.text);

  options.stop.throwIfAborted();

  if (failure !== null && !hasHostError(options.hostErrors.text)) {
    throw failure;
  }
}

// The host keeps running when one consumer task stops, and only prints the error, so the lane keeps
// the run's stderr for a test to read. Each line still reaches the lane's own stderr.
interface HostErrors {
  text: string;
}

async function readHostErrors(
  stream: ReadableStream<Uint8Array>,
  hostErrors: HostErrors,
): Promise<void> {
  const decoder = new TextDecoder();

  for await (const chunk of stream) {
    process.stderr.write(chunk);

    hostErrors.text += decoder.decode(chunk, { stream: true });
  }
}

// the host prints each error of `run` on a line that starts with `pepys: `
function hasHostError(text: string): boolean {
  return text.split('\n').some((line) => line.startsWith('pepys: '));
}

async function waitForAPI(rpcURL: string, stop: AbortSignal, start: Bun.Subprocess): Promise<void> {
  // any answer shows the API listens; a refused connection rejects and is tried again
  await waitFor(
    async () => {
      if (stop.aborted) {
        return;
      }

      throwIfStartEnded(start);

      await fetch(rpcURL);
    },
    { intervalMs: 100, timeoutMs: startDeadlineMs, label: 'the API' },
  );

  stop.throwIfAborted();
}
