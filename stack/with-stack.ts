import { claimFreePorts } from '@zgeoff/testing/process';
import { $ } from 'bun';
import invariant from 'tiny-invariant';
import { StackInterruptedError } from './stack-interrupted-error.ts';

interface GarageAccess {
  endpoint: string;
  region: string;
  blobsBucket: string;
  accessKeyID: string;
  secretAccessKey: string;
}

export interface RunningStack {
  // the compose project, whose label marks each container, volume and network of the stack
  project: string;
  s2Endpoint: string;
  s2AccessToken: string;
  s2Basin: string;
  garage: GarageAccess;
  stop: AbortSignal;
}

const composeFile = `${import.meta.dir}/compose.yaml`;
const signalExitCodes = { SIGINT: 130, SIGTERM: 143 } as const;

// Invented local fixtures, matching compose.yaml.
const garageKeyID = 'GK000000000000000000000000';
const garageSecretKey = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const garageBlobsBucket = 'blobs';

// Runs the callback against Garage and s2-lite in one fresh compose project, and removes the project
// on every exit once it has confirmed that the project holds nothing this run did not make.
// SIGINT or SIGTERM aborts the stop signal, and the run then throws a StackInterruptedError.
export async function withStack<Result>(
  run: (stack: RunningStack) => Promise<Result>,
): Promise<Result> {
  const projectName = `pepys-stack-${crypto.randomUUID().slice(0, 8)}`;

  // a script, not a test, so the run's end releases the claims
  const ports = claimFreePorts(2, { cleanup: 'manual' });
  const s2Port = ports.take();
  const garagePort = ports.take();

  const stopController = new AbortController();

  const received: { signal?: keyof typeof signalExitCodes } = {};

  const handlers = (['SIGINT', 'SIGTERM'] as const).map((signal) => {
    const listener = (): void => {
      received.signal ??= signal;

      console.error(`${signal} received, stopping the stack`);
      stopController.abort();
    };

    process.on(signal, listener);

    return { signal, listener };
  });

  const compose = (args: readonly string[]): Promise<$.ShellOutput> =>
    $`docker compose --project-name ${projectName} --file ${composeFile} --profile s2-lite ${args}`
      .env({ ...process.env, S2_LITE_PORT: String(s2Port), GARAGE_PORT: String(garagePort) })
      .quiet();

  let settled: { ok: true; value: Result } | { ok: false; error: unknown };
  let owned = false;

  try {
    const foreign = await readProjectResources(projectName);

    if (foreign !== '') {
      throw new Error(
        `Docker already holds resources for ${projectName}, so the stack refuses them`,
      );
    }

    // Every resource under this project name from here on is this run's, since none existed before.
    owned = true;

    await startStack(compose, stopController.signal, s2Port);

    const value = await run({
      project: projectName,
      s2Endpoint: `http://127.0.0.1:${s2Port}`,
      s2AccessToken: 'ignored',
      s2Basin: 'pepys-local',
      garage: {
        endpoint: `http://127.0.0.1:${garagePort}`,
        region: 'garage',
        blobsBucket: garageBlobsBucket,
        accessKeyID: garageKeyID,
        secretAccessKey: garageSecretKey,
      },
      stop: stopController.signal,
    });

    settled = { ok: true, value };
  } catch (error: unknown) {
    settled = { ok: false, error };
  }

  if (owned) {
    try {
      // s2-lite ignores SIGTERM, so Docker's default 10 s stop wait ends in SIGKILL (exit 137)
      // anyway; the volumes go with the project, so nothing a graceful stop saves is kept.
      await compose(['down', '--volumes', '--remove-orphans', '--timeout', '0']);

      console.error(`removed compose project ${projectName}`);
    } catch (error: unknown) {
      console.error(`could not remove compose project ${projectName}`, error);
    }
  }

  ports.release();

  for (const handler of handlers) {
    process.off(handler.signal, handler.listener);
  }

  if (received.signal !== undefined) {
    throw new StackInterruptedError(received.signal, signalExitCodes[received.signal]);
  }

  if (!settled.ok) {
    throw settled.error;
  }

  return settled.value;
}

async function readProjectResources(projectName: string): Promise<string> {
  const label = `label=com.docker.compose.project=${projectName}`;

  const containers = await $`docker ps --all --quiet --filter ${label}`.quiet();
  const volumes = await $`docker volume ls --quiet --filter ${label}`.quiet();
  const networks = await $`docker network ls --quiet --filter ${label}`.quiet();

  return [containers, volumes, networks]
    .map((output) => output.stdout.toString())
    .join('')
    .trim();
}

type Compose = (args: readonly string[]) => Promise<$.ShellOutput>;

async function startStack(compose: Compose, stop: AbortSignal, s2Port: number): Promise<void> {
  stop.throwIfAborted();

  await compose(['up', '--detach', 'garage']);
  await createGarageBucket(compose, stop);

  stop.throwIfAborted();

  await compose(['up', '--detach', 's2-lite']);
  await waitForHealth(`http://127.0.0.1:${s2Port}`, stop);
}

const garageBucket = 'facts';

type RunGarage = (args: readonly string[]) => Promise<$.ShellOutput>;

async function createGarageBucket(compose: Compose, stop: AbortSignal): Promise<void> {
  const runGarage: RunGarage = (args) => compose(['exec', '-T', 'garage', '/garage', ...args]);

  await waitForGarageRPC(runGarage, stop);

  const nodeID = await readGarageNodeID(runGarage);

  await runGarage(['layout', 'assign', '-z', 'dc1', '-c', '1G', nodeID]);
  await runGarage(['layout', 'apply', '--version', '1']);
  await runGarage(['key', 'import', '--yes', '-n', 's2-lite', garageKeyID, garageSecretKey]);

  for (const bucket of [garageBucket, garageBlobsBucket]) {
    await runGarage(['bucket', 'create', bucket]);

    await runGarage([
      'bucket',
      'allow',
      '--read',
      '--write',
      '--owner',
      bucket,
      '--key',
      's2-lite',
    ]);
  }
}

const healthTimeoutMs = 60_000;

// `garage node id` reads the node key from the metadata folder without asking the daemon, and the
// daemon writes that key before it listens for RPC, so only a command sent over RPC shows it is up.
async function waitForGarageRPC(runGarage: RunGarage, stop: AbortSignal): Promise<void> {
  const deadline = Date.now() + healthTimeoutMs;

  while (Date.now() < deadline) {
    stop.throwIfAborted();

    const answered = await runGarage(['status']).then(
      () => true,
      () => false,
    );

    if (answered) {
      return;
    }

    await Bun.sleep(250);
  }

  throw new Error('Garage did not answer RPC before the deadline');
}

async function readGarageNodeID(runGarage: RunGarage): Promise<string> {
  const output = await runGarage(['node', 'id', '-q']);

  const [nodeID = ''] = output.stdout.toString().trim().split('@');

  invariant(nodeID !== '', 'Garage answered RPC but printed no node ID');

  return nodeID;
}

async function waitForHealth(s2Endpoint: string, stop: AbortSignal): Promise<void> {
  const deadline = Date.now() + healthTimeoutMs;

  while (Date.now() < deadline) {
    stop.throwIfAborted();

    const response = await fetch(`${s2Endpoint}/health`).catch(() => null);

    if (response?.ok ?? false) {
      return;
    }

    await Bun.sleep(50);
  }

  throw new Error('s2-lite did not report healthy before the deadline');
}
