import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createS2FactLog } from '@pepys/ingest';
import { parseFactEnvelope } from '@pepys/kit';
import type { FactEnvelope, StreamName, StreamOffset } from '@pepys/kit';
import { consumerBuildManifestSchema } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { buildStackEnv } from '../../../../stack/build-stack-env.ts';
import { withStack } from '../../../../stack/with-stack.ts';
import type { RunningStack } from '../../../../stack/with-stack.ts';
import { createIdentityIssuer } from '../../../ingest/src/sender-proof/imp-identity/test-utils/create-identity-issuer.ts';
import type { IdentityIssuer } from '../../../ingest/src/sender-proof/imp-identity/test-utils/create-identity-issuer.ts';
import ledgerJourney from '../../../testing/src/ledger/ledger-journey.json' with { type: 'json' };
import { e2eReadConsumers } from '../../e2e/fixtures/e2e-read-consumers.ts';
import { e2eSecrets } from './e2e-secrets.ts';
import { readFreePort } from './read-free-port.ts';

const root = join(import.meta.dir, '../../../..');
const consumersPath = join(root, 'build/e2e-consumers/consumers.json');

export interface E2EStack {
  stack: RunningStack;
  storeDirectory: string;
  issuer: IdentityIssuer;
  hostBinary: string;

  // the origins that ingest and the API listen on, once a caller starts them
  ingestURL: string;
  apiURL: string;

  // what ingest, the API and the host of the e2e deployment read
  environment: Record<string, string | undefined>;
}

// Starts Garage and s2-lite with what the e2e deployment needs first: the store folder, an identity
// issuer's trust document, the ledger journey and the environment. The caller starts ingest, the
// API and the host; `cleanup` removes the rest, the compose project last.
export async function startE2EStack(cleanup: AsyncDisposableStack): Promise<E2EStack> {
  const hostBinary = join(root, 'target/debug/pepys');

  await checkBuilt(hostBinary);

  const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-e2e-'));

  cleanup.defer(() => rm(storeDirectory, { recursive: true, force: true }));

  const stack = await startStack(cleanup);
  const trustDirectory = await mkdtemp(join(tmpdir(), 'pepys-e2e-trust-'));

  cleanup.defer(() => rm(trustDirectory, { recursive: true, force: true }));

  const issuer = await createIdentityIssuer(e2eSecrets.identityIssuer);

  // ingest reads the trust documents once, at start
  await Bun.write(
    join(trustDirectory, `${e2eSecrets.identityIssuer}.json`),
    JSON.stringify(issuer.document),
  );

  // `run --up` replays the ledger journey at start, so the stream holds it before the start
  await writeLedgerJourney(stack);

  const ingestPort = readFreePort();
  const apiPort = readFreePort();

  return {
    stack,
    storeDirectory,
    issuer,
    hostBinary,
    ingestURL: `http://127.0.0.1:${ingestPort}`,
    apiURL: `http://127.0.0.1:${apiPort}`,
    environment: {
      ...process.env,
      ...buildStackEnv(stack),
      PEPYS_STORE_DIR: storeDirectory,
      PEPYS_CONSUMERS: consumersPath,
      PEPYS_HOST_BIN: hostBinary,
      PEPYS_INGEST_PORT: String(ingestPort),
      PEPYS_API_PORT: String(apiPort),
      PEPYS_GITHUB_WEBHOOK_SECRET: e2eSecrets.githubWebhook,

      // The first pull runs a minute after start, and with no marks it calls no API.
      PEPYS_GITHUB_APP_ID: '1',
      PEPYS_GITHUB_APP_PRIVATE_KEY: 'unused',
      PEPYS_TELEMETRY_TOKEN: e2eSecrets.telemetry,
      PEPYS_IMP_IDENTITY_ISSUERS: trustDirectory,
      PEPYS_IMP_IDENTITY_AUDIENCE: e2eSecrets.identityAudience,
      LOGBOOK_SECRET: e2eSecrets.logbook,

      // the ledger's route goes unused: the ledger journey goes to s2-lite directly
      LEDGER_SECRET: e2eSecrets.ledger,
    },
  };
}

// the host reads consumers.json and each module it lists, which the last
// `bun run consumers:build` wrote
async function checkBuilt(hostBinary: string): Promise<void> {
  if (!existsSync(hostBinary) || !existsSync(consumersPath)) {
    throw new Error('build the host and the consumers first: bun run test:e2e:prepare');
  }

  const text: unknown = await Bun.file(consumersPath).json();

  const listed = new Set(
    consumerBuildManifestSchema.parse(text).consumers.map((consumer) => consumer.name),
  );

  const missing = e2eReadConsumers.filter((entry) => !listed.has(entry.consumer.name));

  if (missing.length > 0) {
    const names = missing.map((entry) => entry.consumer.name).join(', ');

    throw new Error(`consumers.json lists no ${names}: bun run test:e2e:prepare`);
  }
}

// withStack removes the compose project when its callback returns, so the callback holds the stack
// open until the cleanup runs
async function startStack(cleanup: AsyncDisposableStack): Promise<RunningStack> {
  const stackReady = Promise.withResolvers<RunningStack>();
  const released = Promise.withResolvers<void>();

  const run = withStack(async (stack) => {
    stackReady.resolve(stack);

    await released.promise;
  });

  cleanup.defer(async () => {
    released.resolve();

    await run;
  });

  const stack = await Promise.race([stackReady.promise, waitForStackEnd(run)]);

  if (stack === null) {
    throw new Error('the stack stopped before it started');
  }

  return stack;
}

async function waitForStackEnd(run: Promise<void>): Promise<null> {
  await run;

  return null;
}

// The ledger journey holds stored envelopes, repeats included, which no fact batch sends as they are,
// so they go to s2-lite directly, before `up` replays them.
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
