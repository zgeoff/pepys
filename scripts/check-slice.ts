// Runs the thin slice end to end against Garage and s2-lite in Docker: a signed pull request
// webhook through ingest and the host to the consumer's Turso file. It needs PEPYS_ZIG_BIN,
// PEPYS_WASM_TOOLS_BIN and Docker, and it removes everything it starts on every exit.
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Webhooks } from '@octokit/webhooks';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { APIClient } from '@pepys/api';
import { S2 } from '@s2-dev/streamstore';
import { connect } from '@tursodatabase/database';
import type { Database } from '@tursodatabase/database';
import { StackInterruptedError } from '../stack/stack-interrupted-error.ts';
import { withStack } from '../stack/with-stack.ts';
import type { RunningStack } from '../stack/with-stack.ts';

const root = join(import.meta.dir, '..');
const consumerName = 'github_pull_request';
const streamName = 'facts.github.pull_request';
const webhookSecret = 'slice-check-webhook-secret';
const host = join(root, 'target/debug/pepys');
const childEnvironment = { ...process.env, RUSTUP_TOOLCHAIN: undefined };

if (
  process.env['PEPYS_ZIG_BIN'] === undefined ||
  process.env['PEPYS_WASM_TOOLS_BIN'] === undefined
) {
  console.error('set PEPYS_ZIG_BIN and PEPYS_WASM_TOOLS_BIN');
  process.exit(1);
}

const storeDirectory = await mkdtemp(join(tmpdir(), 'pepys-slice-'));

const children: Bun.Subprocess[] = [];

try {
  await runChecked(['cargo', 'build', '--bin', 'pepys']);
  await runChecked(['bun', 'scripts/build-consumers.ts']);

  const modulePath = await readModule();

  await withStack((stack) => runSlice(stack, modulePath));

  console.log('slice:check passed');
} catch (error: unknown) {
  if (error instanceof StackInterruptedError) {
    process.exitCode = error.exitCode;
  } else {
    console.error(error);

    process.exitCode = 1;
  }
} finally {
  for (const child of children) {
    child.kill('SIGTERM');
  }

  await Promise.all(children.map((child) => child.exited));

  await rm(storeDirectory, { recursive: true, force: true });
}

async function runChecked(command: string[]): Promise<string> {
  const child = Bun.spawn(command, {
    cwd: root,
    env: childEnvironment,
    stdout: 'pipe',
    stderr: 'inherit',
  });

  children.push(child);

  const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} exited with ${exitCode}\n${output}`);
  }

  return output;
}

async function readModule(): Promise<string> {
  const directory = join(root, 'build/consumers', consumerName);

  const names = await readdir(directory);

  const files = names.filter((name) => name.endsWith('.wasm'));

  const modified = files.map((name) => ({
    name,
    time: Bun.file(join(directory, name)).lastModified,
  }));

  const [newest] = modified.toSorted((first, second) => second.time - first.time);

  if (newest === undefined) {
    throw new Error(`no built module for ${consumerName}`);
  }

  return join(directory, newest.name);
}

async function runSlice(stack: RunningStack, modulePath: string): Promise<void> {
  const hostEnvironment = {
    ...childEnvironment,
    PEPYS_S2_ENDPOINT: stack.s2Endpoint,
    PEPYS_S2_ACCESS_TOKEN: stack.s2AccessToken,
    PEPYS_S2_BASIN: stack.s2Basin,
    PEPYS_STORE_DIR: storeDirectory,
  };

  const ingestPort = readFreePort();

  const ingest = Bun.spawn(['bun', 'packages/source-github/src/ingest/serve-ingest.ts'], {
    cwd: root,
    env: {
      ...hostEnvironment,
      PEPYS_INGEST_PORT: String(ingestPort),
      PEPYS_GITHUB_WEBHOOK_SECRET: webhookSecret,
    },
    stdout: 'inherit',
    stderr: 'inherit',
  });

  children.push(ingest);

  const webhookURL = `http://127.0.0.1:${ingestPort}/webhook`;

  await waitForIngest(webhookURL, stack.stop);

  const runHost = async (args: string[]): Promise<string> => {
    const child = Bun.spawn([host, ...args], {
      cwd: root,
      env: hostEnvironment,
      stdout: 'pipe',
      stderr: 'inherit',
    });

    children.push(child);

    const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

    if (exitCode !== 0) {
      throw new Error(`pepys ${args.join(' ')} exited with ${exitCode}\n${output}`);
    }

    return output;
  };

  const firstUp = await runHost(['up', consumerName, '--module', modulePath]);

  console.log(firstUp.trim());

  const opened = buildDelivery({
    deliveryID: 'slice-delivery-1',
    action: 'opened',
    title: 'Add the harbour map',
    updatedAt: '2026-10-01T09:00:00Z',
  });

  const synchronized = buildDelivery({
    deliveryID: 'slice-delivery-2',
    action: 'synchronize',
    title: 'Add the harbour map and tides',
    updatedAt: '2026-10-01T10:00:00Z',
  });

  const outOfOrder = buildDelivery({
    deliveryID: 'slice-delivery-3',
    action: 'edited',
    title: 'An older title',
    updatedAt: '2026-10-01T09:30:00Z',
  });

  for (const delivery of [opened, synchronized, opened, outOfOrder]) {
    await sendDelivery(webhookURL, delivery);
  }

  const tail = await readTail(stack);

  if (tail !== 4) {
    throw new Error(`expected 4 records in the stream, found ${tail}`);
  }

  await runUntilCaughtUp(hostEnvironment, tail, stack.stop);

  const databasePath = join(storeDirectory, consumerName, 'current', 'consumer.db');

  const database = await connect(databasePath, {
    readonly: true,
    experimental: ['multiprocess_wal'],
  });

  try {
    const rows = await queryAll(database, `select * from ${consumerName}`);
    const offsets = await queryAll(database, 'select * from offsets');
    const changeLog = await queryAll(database, 'select * from change_log order by batch');

    assertEqual(
      rows.map((row) => readRow(row)),
      [readExpectedRow(synchronized)],
      'the row of the newest fact',
    );

    assertEqual(offsets, [{ stream: streamName, last_seq_num: tail - 1 }], 'the offsets row');

    assertEqual(
      changeLog.flatMap((entry) => readOperations(entry)),
      [
        { key: 'github:pr:1874433021', operation: 'insert' },
        { key: 'github:pr:1874433021', operation: 'update' },
      ],
      'the change log operations',
    );
  } finally {
    await database.close();
  }

  const previewOutput = await runHost(['preview', consumerName, '--module', modulePath]);

  const diff: unknown = JSON.parse(previewOutput);

  assertEqual(diff, {}, 'the preview diff');

  const secondUp = await runHost(['up', consumerName, '--module', modulePath]);

  if (!secondUp.includes('no swap')) {
    throw new Error(`expected no swap from the second up, got: ${secondUp}`);
  }

  await checkAPI(hostEnvironment, synchronized, stack.stop);
}

async function checkAPI(
  environment: Record<string, string | undefined>,
  delivery: Delivery,
  stop: AbortSignal,
): Promise<void> {
  const apiPort = readFreePort();

  const api = Bun.spawn(['bun', 'packages/api/src/serve.ts'], {
    cwd: root,
    env: { ...environment, PEPYS_API_PORT: String(apiPort) },
    stdout: 'inherit',
    stderr: 'inherit',
  });

  children.push(api);

  const rpcURL = `http://127.0.0.1:${apiPort}/rpc`;

  await waitForAPI(rpcURL, stop);

  const client: APIClient = createORPCClient(new RPCLink({ url: rpcURL }));

  const result = await client.get_entity({ id: 'github:pr:1874433021' });

  assertEqual(result, readExpectedEntity(delivery), 'the get_entity result');
}

async function waitForAPI(url: string, stop: AbortSignal): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    stop.throwIfAborted();

    const response = await fetch(url).catch(() => null);

    if (response !== null) {
      return;
    }

    await Bun.sleep(100);
  }

  throw new Error('the API did not answer before the deadline');
}

interface Delivery {
  deliveryID: string;
  body: string;
  action: string;
  title: string;
  updatedAt: string;
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

  return { ...parameters, body };
}

async function sendDelivery(url: string, delivery: Delivery): Promise<void> {
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

  if (response.status !== 202) {
    throw new Error(`ingest answered ${response.status} to ${delivery.deliveryID}`);
  }
}

async function waitForIngest(url: string, stop: AbortSignal): Promise<void> {
  const deadline = Date.now() + 30_000;

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
  environment: Record<string, string | undefined>,
  tail: number,
  stop: AbortSignal,
): Promise<void> {
  const run = Bun.spawn([host, 'run', consumerName], {
    cwd: root,
    env: environment,
    stdout: 'inherit',
    stderr: 'inherit',
  });

  children.push(run);

  const databasePath = join(storeDirectory, consumerName, 'current', 'consumer.db');
  const deadline = Date.now() + 60_000;

  try {
    while (Date.now() < deadline) {
      stop.throwIfAborted();

      if ((await readLastSeqNum(databasePath)) === tail - 1) {
        return;
      }

      await Bun.sleep(200);
    }

    throw new Error('pepys run did not catch up before the deadline');
  } finally {
    run.kill('SIGTERM');

    await run.exited;
  }
}

async function readLastSeqNum(databasePath: string): Promise<number | undefined> {
  try {
    const database = await connect(databasePath, {
      readonly: true,
      experimental: ['multiprocess_wal'],
    });

    try {
      const rows = await queryAll(database, 'select last_seq_num from offsets');

      const first: unknown = rows[0];

      return typeof first === 'object' && first !== null && 'last_seq_num' in first
        ? Number(first.last_seq_num)
        : undefined;
    } finally {
      await database.close();
    }
  } catch {
    return undefined;
  }
}

function readFreePort(): number {
  const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: () => {} } });
  const port = listener.port;

  listener.stop(true);

  return port;
}

function readRow(row: unknown): unknown {
  if (typeof row !== 'object' || row === null || !('payload' in row)) {
    throw new Error('the stored row has no payload');
  }

  const payload: unknown = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

  return { ...row, payload };
}

function readExpectedRow(delivery: Delivery): unknown {
  const body: unknown = JSON.parse(delivery.body);

  if (typeof body !== 'object' || body === null || !('pull_request' in body)) {
    throw new Error('the delivery has no pull request');
  }

  return {
    id: 'github:pr:1874433021',
    number: 12,
    repository_id: 'github:repo:902',
    title: delivery.title,
    state: 'open',
    is_draft: 0,
    is_merged: 0,
    author_id: 'github:user:4401',
    url: 'https://github.example/acme/harbour/pull/12',
    merge_commit_sha: null,
    created_at: '2026-10-01T08:00:00Z',
    updated_at: delivery.updatedAt,
    closed_at: null,
    merged_at: null,
    payload: body.pull_request,
  };
}

function readExpectedEntity(delivery: Delivery): unknown {
  const row = readExpectedRow(delivery);

  if (typeof row !== 'object' || row === null) {
    throw new Error('the expected row is not an object');
  }

  return {
    entity: {
      id: 'github:pr:1874433021',
      kind: 'pr',
      title: delivery.title,
      url: 'https://github.example/acme/harbour/pull/12',
      actor: 'github:user:4401',
      updated_at: delivery.updatedAt,
    },
    row: { ...row, is_draft: false, is_merged: false },
  };
}

function readOperations(entry: unknown): { key: unknown; operation: unknown }[] {
  if (typeof entry !== 'object' || entry === null || !('changes' in entry)) {
    throw new Error('a change log row has no changes');
  }

  const changes: unknown = JSON.parse(String(entry.changes));

  if (!Array.isArray(changes)) {
    throw new TypeError('the changes of a change log row are not a list');
  }

  return changes.map((change: unknown) => {
    if (
      typeof change !== 'object' ||
      change === null ||
      !('key' in change) ||
      !('headers' in change) ||
      typeof change.headers !== 'object' ||
      change.headers === null ||
      !('operation' in change.headers)
    ) {
      throw new Error('a change is not a State Protocol message');
    }

    return { key: change.key, operation: change.headers.operation };
  });
}

function assertEqual(actual: unknown, expected: unknown, what: string): void {
  if (!Bun.deepEquals(actual, expected, true)) {
    throw new Error(
      `${what} differs\nexpected ${JSON.stringify(expected, null, 2)}\nactual   ${JSON.stringify(actual, null, 2)}`,
    );
  }
}

async function queryAll(database: Database, sql: string): Promise<unknown[]> {
  const statement = await database.prepare(sql);

  return statement.all();
}
