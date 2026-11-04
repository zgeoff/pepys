// Builds the pull request consumer's file from s2-lite, copies the stream to Parquet, stops
// s2-lite, rebuilds the file from the Parquet copy alone and compares the two files. It needs
// PEPYS_ZIG_BIN, PEPYS_WASM_TOOLS_BIN and Docker, and removes what it starts on every exit.
import { cp, mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Webhooks } from '@octokit/webhooks';
import { S2 } from '@s2-dev/streamstore';
import type { S2Stream } from '@s2-dev/streamstore';
import { connect } from '@tursodatabase/database';
import { $ } from 'bun';
import { StackInterruptedError } from '../../stack/stack-interrupted-error.ts';
import { withStack } from '../../stack/with-stack.ts';
import type { RunningStack } from '../../stack/with-stack.ts';
import { runCompaction } from './run-compaction.ts';
import type { CompactionReport } from './run-compaction.ts';

const root = join(import.meta.dir, '../..');
const consumerName = 'github_pull_request';
const streamName = 'facts.github.pull_request';
const webhookSecret = 'lake-spike-webhook-secret';
const host = join(root, 'target/debug/pepys');
const rebuilder = join(root, 'target/debug/pepys-parquet-escape-hatch');
const childEnvironment = { ...process.env, RUSTUP_TOOLCHAIN: undefined };

// Three batches of deliveries, with a compaction run after each, so the lake holds three files
// and the second and third runs resume from a recorded offset.
const phaseSizes = [100, 100, 50] as const;
const pullRequestCount = 12;

if (
  process.env['PEPYS_ZIG_BIN'] === undefined ||
  process.env['PEPYS_WASM_TOOLS_BIN'] === undefined
) {
  console.error('set PEPYS_ZIG_BIN and PEPYS_WASM_TOOLS_BIN');
  process.exit(1);
}

const workDirectory = await mkdtemp(join(tmpdir(), 'pepys-lake-'));

const children: Bun.Subprocess[] = [];

try {
  await runChecked(['cargo', 'build', '--bin', 'pepys']);

  await runChecked([
    'cargo',
    'build',
    '--manifest-path',
    'research/parquet-escape-hatch/Cargo.toml',
    '--target-dir',
    'target',
  ]);

  await runChecked(['bun', 'scripts/build-consumers.ts']);

  const modulePath = await readModule();
  const report = await withStack((stack) => runSpike(stack, modulePath));

  console.log(JSON.stringify(report, null, 2));

  if (!report.passed) {
    process.exitCode = 1;
  }
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

  await rm(workDirectory, { recursive: true, force: true });
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

  const modified = names
    .filter((name) => name.endsWith('.wasm'))
    .map((name) => ({ name, time: Bun.file(join(directory, name)).lastModified }));

  const [newest] = modified.toSorted((first, second) => second.time - first.time);

  if (newest === undefined) {
    throw new Error(`no built module for ${consumerName}`);
  }

  return join(directory, newest.name);
}

async function runSpike(stack: RunningStack, modulePath: string) {
  const storeDirectory = join(workDirectory, 'store');
  const lakeDirectory = join(workDirectory, 'lake');

  await mkdir(lakeDirectory);

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
  await runHost(hostEnvironment, ['up', consumerName, '--module', modulePath]);

  const stream = openStream(stack);
  const deliveries = buildDeliveries(phaseSizes.reduce((sum, size) => sum + size, 0));
  const compactions: (CompactionReport & { elapsedMs: number })[] = [];
  let sent = 0;

  for (const size of phaseSizes) {
    for (const delivery of deliveries.slice(sent, sent + size)) {
      await sendDelivery(webhookURL, delivery);
    }

    sent += size;

    const compaction = await runTimedCompaction(stream, lakeDirectory);

    compactions.push(compaction);
  }

  // A run with no new records writes no file and keeps the offset.
  const emptyCompaction = await runTimedCompaction(stream, lakeDirectory);

  compactions.push(emptyCompaction);

  const tailResponse = await stream.checkTail();

  const tail = tailResponse.tail.seqNum;
  const logFile = join(storeDirectory, consumerName, 'current', 'consumer.db');

  await runUntilCaughtUp(hostEnvironment, logFile, tail, stack.stop);

  const s2Stopped = await stopS2Lite(stack.s2Endpoint);

  const rebuiltFile = join(workDirectory, 'rebuilt', 'consumer.db');

  await mkdir(join(workDirectory, 'rebuilt'));

  const rebuild = await runRebuild(lakeDirectory, modulePath, rebuiltFile);
  const fromLog = await readSnapshot(logFile);
  const fromLake = await readSnapshot(rebuiltFile);

  const comparison = {
    rows: Bun.deepEquals(fromLog.rows, fromLake.rows, true),
    offsets: Bun.deepEquals(fromLog.offsets, fromLake.offsets, true),
    appliedFacts: Bun.deepEquals(fromLog.appliedFacts, fromLake.appliedFacts, true),
    operations: Bun.deepEquals(fromLog.operations, fromLake.operations, true),
    changeLogRows: Bun.deepEquals(fromLog.changeLog, fromLake.changeLog, true),
  };

  const gapCheck = await runMissingFileCheck(lakeDirectory, modulePath, compactions[1]?.files[0]);
  const shortCheck = await runMissingFileCheck(lakeDirectory, modulePath, compactions[2]?.files[0]);

  const passed =
    s2Stopped &&
    rebuild.ok &&
    comparison.rows &&
    comparison.offsets &&
    comparison.appliedFacts &&
    comparison.operations &&
    gapCheck.refused &&
    shortCheck.refused;

  return {
    passed,
    sentDeliveries: deliveries.length,
    distinctFacts: new Set(deliveries.map((delivery) => delivery.deliveryID)).size,
    tail,
    compactions,
    s2Stopped,
    rebuild,
    counts: {
      rows: fromLog.rows.length,
      appliedFacts: fromLog.appliedFacts.length,
      operations: fromLog.operations.length,
      changeLogRowsFromLog: fromLog.changeLog.length,
      changeLogRowsFromLake: fromLake.changeLog.length,
    },
    comparison,
    gapCheck,
    shortCheck,
  };
}

async function runHost(
  environment: Record<string, string | undefined>,
  args: string[],
): Promise<string> {
  const child = Bun.spawn([host, ...args], {
    cwd: root,
    env: environment,
    stdout: 'pipe',
    stderr: 'inherit',
  });

  children.push(child);

  const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

  if (exitCode !== 0) {
    throw new Error(`pepys ${args.join(' ')} exited with ${exitCode}\n${output}`);
  }

  return output;
}

function openStream(stack: RunningStack): S2Stream {
  const client = new S2({
    accessToken: stack.s2AccessToken,
    endpoints: { account: stack.s2Endpoint, basin: stack.s2Endpoint },
  });

  return client.basin(stack.s2Basin).stream(streamName);
}

async function runTimedCompaction(
  stream: S2Stream,
  lakeDirectory: string,
): Promise<CompactionReport & { elapsedMs: number }> {
  const started = performance.now();

  const report = await runCompaction({ stream, streamName, lakeDirectory });

  return { ...report, elapsedMs: Math.round(performance.now() - started) };
}

interface Delivery {
  deliveryID: string;
  body: string;
}

// Invented pull requests in one invented repository. Send n goes to pull request n mod 12. Every
// 17th send repeats an earlier delivery, as a GitHub redelivery does, and every 23rd send is an
// edit whose updated_at is older than the pull request's last one.
function buildDeliveries(count: number): Delivery[] {
  const deliveries: Delivery[] = [];

  for (let index = 0; index < count; index += 1) {
    const repeated = deliveries[index - 5];

    if (index % 17 === 16 && repeated !== undefined) {
      deliveries.push(repeated);
      continue;
    }

    const pullRequest = index % pullRequestCount;
    const step = Math.floor(index / pullRequestCount);
    const isLate = index % 23 === 22 && step >= 2;
    const isLast = index >= count - pullRequestCount;
    const isMerged = isLast && pullRequest % 2 === 0;

    const updatedAt = new Date(Date.UTC(2026, 9, 1, 8 + (isLate ? step - 2 : step)));

    deliveries.push(
      buildDelivery({
        deliveryID: `lake-delivery-${index}`,
        action: pickAction(step, isLate, isMerged),
        pullRequest,
        title: `Chart harbour berth ${pullRequest}, revision ${isLate ? step - 2 : step}`,
        updatedAt: updatedAt.toISOString(),
        isMerged,
      }),
    );
  }

  return deliveries;
}

function pickAction(step: number, isLate: boolean, isMerged: boolean): string {
  if (isMerged) {
    return 'closed';
  }

  if (step === 0) {
    return 'opened';
  }

  return isLate || step % 2 === 0 ? 'edited' : 'synchronize';
}

interface DeliveryParameters {
  deliveryID: string;
  action: string;
  pullRequest: number;
  title: string;
  updatedAt: string;
  isMerged: boolean;
}

function buildDelivery(parameters: DeliveryParameters): Delivery {
  const id = 2_000_000_100 + parameters.pullRequest;
  const number = 40 + parameters.pullRequest;
  const author = 5500 + (parameters.pullRequest % 3);

  const body = JSON.stringify({
    action: parameters.action,
    number,
    pull_request: {
      id,
      number,
      title: parameters.title,
      state: parameters.isMerged ? 'closed' : 'open',
      draft: false,
      merged: parameters.isMerged,
      merge_commit_sha: parameters.isMerged
        ? `${String(number).padStart(4, '0')}${'c'.repeat(36)}`
        : null,
      html_url: `https://github.example/acme/harbour/pull/${number}`,
      user: { id: author },
      base: { repo: { id: 902 } },
      created_at: '2026-10-01T07:00:00Z',
      updated_at: parameters.updatedAt,
      closed_at: parameters.isMerged ? parameters.updatedAt : null,
      merged_at: parameters.isMerged ? parameters.updatedAt : null,
    },
    sender: { id: author },
  });

  return { deliveryID: parameters.deliveryID, body };
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

async function runUntilCaughtUp(
  environment: Record<string, string | undefined>,
  databasePath: string,
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

  const deadline = Date.now() + 120_000;

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
      const rows: unknown[] = await database.all('select last_seq_num from offsets');

      const [first] = rows;

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

// Stops the s2-lite container that publishes the stack's port, and reports whether the log then
// refuses connections.
async function stopS2Lite(s2Endpoint: string): Promise<boolean> {
  const port = new URL(s2Endpoint).port;

  const listing = await $`docker ps --quiet --filter publish=${port}`.quiet();

  const containers = listing.stdout
    .toString()
    .trim()
    .split('\n')
    .filter((id) => id !== '');

  if (containers.length !== 1) {
    throw new Error(`expected one container on port ${port}, found ${containers.length}`);
  }

  await $`docker stop ${containers}`.quiet();

  const response = await fetch(`${s2Endpoint}/health`).catch(() => null);

  return response === null;
}

async function runRebuild(lakeDirectory: string, modulePath: string, output: string) {
  const child = Bun.spawn([rebuilder, consumerName, lakeDirectory, modulePath, output], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  children.push(child);

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (exitCode !== 0) {
    return { ok: false, error: stderr.trim() } as const;
  }

  const summary: unknown = JSON.parse(stdout);

  return { ok: true, summary } as const;
}

// Copies the lake without one file and checks that the rebuild refuses it.
async function runMissingFileCheck(
  lakeDirectory: string,
  modulePath: string,
  file: string | undefined,
) {
  if (file === undefined) {
    throw new Error('the compaction run wrote no file');
  }

  const name = crypto.randomUUID().slice(0, 8);
  const copiedLake = join(workDirectory, `lake-${name}`);
  const output = join(workDirectory, `rebuilt-${name}`, 'consumer.db');

  await cp(lakeDirectory, copiedLake, { recursive: true });
  await rm(join(copiedLake, streamName, file));
  await mkdir(join(workDirectory, `rebuilt-${name}`));

  const rebuild = await runRebuild(copiedLake, modulePath, output);

  return { removed: file, refused: !rebuild.ok, error: rebuild.ok ? null : rebuild.error };
}

interface Snapshot {
  rows: unknown[];
  offsets: unknown[];
  appliedFacts: unknown[];
  changeLog: unknown[];
  operations: unknown[];
}

async function readSnapshot(databasePath: string): Promise<Snapshot> {
  const database = await connect(databasePath, {
    readonly: true,
    experimental: ['multiprocess_wal'],
  });

  try {
    const changeLog: unknown[] = await database.all(
      'select batch, changes from change_log order by batch',
    );

    const rows: unknown[] = await database.all(`select * from ${consumerName} order by id`);
    const offsets: unknown[] = await database.all('select * from offsets order by stream');

    const appliedFacts: unknown[] = await database.all(
      'select fact_id from applied_facts order by fact_id',
    );

    return {
      rows,
      offsets,
      appliedFacts,
      changeLog,
      operations: changeLog.flatMap((entry) => readChanges(entry)),
    };
  } finally {
    await database.close();
  }
}

function readChanges(entry: unknown): unknown[] {
  if (typeof entry !== 'object' || entry === null || !('changes' in entry)) {
    throw new Error('a change log row has no changes');
  }

  const changes: unknown = JSON.parse(String(entry.changes));

  if (!Array.isArray(changes)) {
    throw new TypeError('the changes of a change log row are not a list');
  }

  return changes;
}

function readFreePort(): number {
  const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: () => {} } });
  const port = listener.port;

  listener.stop(true);

  return port;
}
