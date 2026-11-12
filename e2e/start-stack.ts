// `test:e2e` preloads this setup. It starts the e2e deployment and sends each fact once for the whole
// lane, so each test's 15 s limit covers its own act and not the container start. Test files may
// not hold beforeAll, and the tests read what it started through the environment.

import { afterAll, beforeAll } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Webhooks } from '@octokit/webhooks';
import { createStoreReader, readOffsets } from '@pepys/api';
import { createS2FactLog } from '@pepys/ingest';
import { parseFactEnvelope } from '@pepys/kit';
import type { ConsumerDeclaration, FactEnvelope, StreamName, StreamOffset } from '@pepys/kit';
import { createFactBatchSender } from '@pepys/kit/send';
import { consumerBuildManifestSchema } from '@pepys/schema';
import { githubPullRequestConsumer } from '@pepys/source-github';
import { telemetryModelRequestConsumer, telemetryTurnCostConsumer } from '@pepys/source-telemetry';
import { S2 } from '@s2-dev/streamstore';
import { toTagged } from '@zgeoff/std';
import { waitFor } from '@zgeoff/testing/helpers';
import { logbookSource, logbookVoyageConsumer } from 'logbook-plugin';
import { createIdentityIssuer } from '../packages/ingest/src/sender-proof/imp-identity/test-utils/create-identity-issuer.ts';
import type { IdentityIssuer } from '../packages/ingest/src/sender-proof/imp-identity/test-utils/create-identity-issuer.ts';
import ledgerJourney from '../packages/testing/src/test-utils/ledger/ledger-journey.json' with { type: 'json' };
import { ledgerAccountConsumer } from '../packages/testing/src/test-utils/ledger/ledger-plugin.ts';
import { stopProcessGroup } from '../scripts/utils/stop-process-group.ts';
import { buildStackEnv } from '../stack/build-stack-env.ts';
import { withStack } from '../stack/with-stack.ts';
import type { RunningStack } from '../stack/with-stack.ts';

const root = join(import.meta.dir, '..');
const webhookSecret = 'github-pr-webhook-secret';
const logbookSecret = 'logbook-e2e-secret';
const telemetryToken = 'telemetry-e2e-token';
const identityAudience = 'pepys-ingest-e2e';
const host = join(root, 'target/debug/pepys');
const consumersPath = join(root, 'build/e2e-consumers/consumers.json');

// Each consumer a test reads, with the stream it reads. The run stops once each has applied the
// tail of its stream.
const readConsumers: readonly { consumer: ConsumerDeclaration; stream: string }[] = [
  { consumer: githubPullRequestConsumer, stream: 'facts.github.pull_request' },
  { consumer: logbookVoyageConsumer, stream: 'facts.logbook.voyage' },
  { consumer: telemetryModelRequestConsumer, stream: 'facts.telemetry.log_record' },
  { consumer: telemetryTurnCostConsumer, stream: 'facts.telemetry.log_record' },
  { consumer: ledgerAccountConsumer, stream: 'facts.ledger.account' },
];

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

    const trustDirectory = await mkdtemp(join(tmpdir(), 'pepys-e2e-trust-'));

    cleanup.defer(() => rm(trustDirectory, { recursive: true, force: true }));

    const runDirectory = await mkdtemp(join(tmpdir(), 'pepys-e2e-run-'));

    cleanup.defer(() => rm(runDirectory, { recursive: true, force: true }));

    const runStderrPath = join(runDirectory, 'stderr.txt');

    const ingestURL = await runSlice({ stack, storeDirectory, trustDirectory, runStderrPath });

    process.env['PEPYS_E2E_INGEST_URL'] = ingestURL;
    process.env['PEPYS_E2E_RUN_STDERR'] = runStderrPath;

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

  const listed = new Set(
    consumerBuildManifestSchema.parse(text).consumers.map((consumer) => consumer.name),
  );

  const missing = readConsumers.filter((entry) => !listed.has(entry.consumer.name));

  if (missing.length > 0) {
    const names = missing.map((entry) => entry.consumer.name).join(', ');

    throw new Error(`consumers.json lists no ${names}: bun run test:e2e:prepare`);
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
  trustDirectory: string;
  runStderrPath: string;
}

// Starts ingest, sends every fact, and runs the host until it has applied them. It returns the
// address of ingest, which keeps running for the tests.
async function runSlice(options: SliceOptions): Promise<string> {
  const ingestPort = readFreePort();

  const issuer = await createIdentityIssuer('harbour-broker');

  // ingest reads the trust documents once, at start
  await Bun.write(
    join(options.trustDirectory, 'harbour-broker.json'),
    JSON.stringify(issuer.document),
  );

  runChild(['bun', 'e2e/deployment/serve-ingest.ts'], {
    ...process.env,
    PEPYS_INGEST_PORT: String(ingestPort),
    PEPYS_GITHUB_WEBHOOK_SECRET: webhookSecret,

    // The first pull runs a minute after start, and with no marks it calls no API.
    PEPYS_GITHUB_APP_ID: '1',
    PEPYS_GITHUB_APP_PRIVATE_KEY: 'unused',
    PEPYS_TELEMETRY_TOKEN: telemetryToken,
    PEPYS_IMP_IDENTITY_ISSUERS: options.trustDirectory,
    PEPYS_IMP_IDENTITY_AUDIENCE: identityAudience,
    LOGBOOK_SECRET: logbookSecret,

    // the ledger's route goes unused: the setup appends the ledger journey to s2-lite itself
    LEDGER_SECRET: 'ledger-e2e-secret',
  });

  const ingestURL = `http://127.0.0.1:${ingestPort}`;
  const webhookURL = `${ingestURL}/webhook/github`;

  await waitForIngest(webhookURL, options.stack.stop);
  await writeLedgerJourney(options.stack);
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

  await writeVoyages(`${ingestURL}/logbook/facts`);
  await writeLogs(`${ingestURL}/v1/logs`, issuer);

  const tails = await readTails(options.stack);

  await runUntilCaughtUp(options.storeDirectory, tails, options.stack.stop, options.runStderrPath);

  return ingestURL;
}

// The ledger journey holds stored envelopes, repeats included, which no fact batch sends as they are,
// so the setup appends them to s2-lite itself, before `up` replays them.
async function writeLedgerJourney(stack: RunningStack): Promise<void> {
  const stream = toTagged<StreamName>('facts.ledger.account');

  const log = await createS2FactLog({
    endpoint: stack.s2Endpoint,
    accessToken: stack.s2AccessToken,
    basin: stack.s2Basin,
    streams: [stream],
  });

  const envelopes: FactEnvelope<unknown>[] = [];

  for (const record of ledgerJourney.records) {
    const body: unknown = JSON.parse(record.body);
    const parsed = parseFactEnvelope(body);

    if (!parsed.ok) {
      throw new Error(`the ledger journey holds a record that is no envelope: ${record.body}`);
    }

    envelopes.push(parsed.value);
  }

  const outcome = await log.appendBatch(stream, envelopes, toTagged<StreamOffset>(0));

  if (outcome.kind !== 'acknowledged') {
    throw new Error(`s2-lite refused the ledger journey: ${JSON.stringify(outcome)}`);
  }
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

// Two voyages in one harbour, one of which cites the pull request, and one in another harbour.
async function writeVoyages(url: string): Promise<void> {
  const send = createFactBatchSender({ source: logbookSource, url, secret: logbookSecret });

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
    audience: identityAudience,
    subject: 'imp-7731',
    name: 'imp-harbour',
    issuedAtSeconds: nowSeconds,
    expiresAtSeconds: nowSeconds + 50,
  });

  // OTLP JSON as Claude Code's exporter writes it: a 64-bit integer is decimal text
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
                body: { stringValue: 'event' },
                attributes: [
                  { key: 'event.name', value: { stringValue: 'api_request' } },
                  { key: 'session.id', value: { stringValue: 'c-harbour' } },
                  { key: 'event.timestamp', value: { stringValue: '2026-11-11T02:20:00.000Z' } },
                  { key: 'request_id', value: { stringValue: 'req_harbour_01' } },
                  { key: 'model', value: { stringValue: 'model-large' } },
                  { key: 'cost_usd', value: { doubleValue: 0.4 } },
                  { key: 'input_tokens', value: { intValue: '12' } },
                  { key: 'cache_read_tokens', value: { intValue: '900' } },
                  { key: 'cache_creation_tokens', value: { intValue: '30' } },
                  { key: 'output_tokens', value: { intValue: '210' } },
                  { key: 'duration_ms', value: { intValue: '4100' } },
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
      authorization: `Bearer ${telemetryToken}`,
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

async function waitForIngest(url: string, stop: AbortSignal): Promise<void> {
  await waitFor(
    async () => {
      if (stop.aborted) {
        return;
      }

      const response = await fetch(url, { method: 'POST' });

      if (response.status !== 401) {
        throw new Error(`ingest answered ${response.status}, not 401`);
      }
    },
    { intervalMs: 100, timeoutMs: startDeadlineMs, label: 'ingest' },
  );

  stop.throwIfAborted();
}

// the tail of each stream that a consumer in `readConsumers` reads, by stream name
async function readTails(stack: RunningStack): Promise<Map<string, number>> {
  const client = new S2({
    accessToken: stack.s2AccessToken,
    endpoints: { account: stack.s2Endpoint, basin: stack.s2Endpoint },
  });

  const tails = new Map<string, number>();

  for (const stream of new Set(readConsumers.map((entry) => entry.stream))) {
    const response = await client.basin(stack.s2Basin).stream(stream).checkTail();

    tails.set(stream, response.tail.seqNum);
  }

  return tails;
}

async function runUntilCaughtUp(
  storeDirectory: string,
  tails: ReadonlyMap<string, number>,
  stop: AbortSignal,
  runStderrPath: string,
): Promise<void> {
  const run = Bun.spawn([host, 'run'], {
    cwd: root,
    env: process.env,
    stdout: 'inherit',
    stderr: 'pipe',
    detached: true,
  });

  cleanup.defer(() => stopProcessGroup(run));

  const hostErrors: HostErrors = { text: '' };
  const reading = readHostErrors(run.stderr, hostErrors);
  const store = createStoreReader({ storeDirectory });

  // a stopped task never catches up, so the wait ends at the first error, which a test reports
  const failure = await waitFor(
    async () => {
      if (stop.aborted || hasHostError(hostErrors.text)) {
        return;
      }

      const lagging = await readLaggingConsumers(store, tails);

      if (lagging.length > 0) {
        throw new Error(`still behind: ${lagging.join(', ')}`);
      }
    },
    { intervalMs: 200, timeoutMs: 60_000, label: 'pepys run to catch up' },
  ).then(
    () => null,
    (error: unknown) => (error instanceof Error ? error : new Error(String(error))),
  );

  await store.close();

  await stopProcessGroup(run);
  await reading;

  await Bun.write(runStderrPath, hostErrors.text);

  stop.throwIfAborted();

  if (failure !== null && !hasHostError(hostErrors.text)) {
    throw failure;
  }
}

// the name of each consumer in `readConsumers` that has not applied the tail of its stream
async function readLaggingConsumers(
  store: ReturnType<typeof createStoreReader>,
  tails: ReadonlyMap<string, number>,
): Promise<string[]> {
  const lagging: string[] = [];

  for (const entry of readConsumers) {
    const offsets = await readOffsets(store, entry.consumer);

    const tail = tails.get(entry.stream);

    const isCaughtUp =
      offsets.ok &&
      offsets.value.some(
        (offset) => offset.stream === entry.stream && offset.lastSeqNum === (tail ?? 0) - 1,
      );

    if (!isCaughtUp) {
      lagging.push(entry.consumer.name);
    }
  }

  return lagging;
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

async function startAPI(stop: AbortSignal): Promise<string> {
  const apiPort = readFreePort();

  runChild(['bun', 'e2e/deployment/serve-api.ts'], {
    ...process.env,
    PEPYS_API_PORT: String(apiPort),
  });

  const rpcURL = `http://127.0.0.1:${apiPort}/rpc`;

  // any answer shows the API listens; a refused connection rejects and is tried again
  await waitFor(
    async () => {
      if (stop.aborted) {
        return;
      }

      await fetch(rpcURL);
    },
    { intervalMs: 100, timeoutMs: startDeadlineMs, label: 'the API' },
  );

  stop.throwIfAborted();

  return rpcURL;
}

function readFreePort(): number {
  const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: () => {} } });
  const port = listener.port;

  listener.stop(true);

  return port;
}
