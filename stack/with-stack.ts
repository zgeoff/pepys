import { $ } from 'bun';
import { StackInterruptedError } from './stack-interrupted-error.ts';

export interface RunningStack {
  s2Endpoint: string;
  s2AccessToken: string;
  s2Basin: string;
  stop: AbortSignal;
}

const composeFile = `${import.meta.dir}/compose.yaml`;
const signalExitCodes = { SIGINT: 130, SIGTERM: 143 } as const;

// Runs the callback against Garage and s2-lite in the containers of one fresh compose project, and
// removes the project on every exit. SIGINT or SIGTERM aborts the callback's stop signal, and the
// run then throws a StackInterruptedError once the project is gone.
export async function withStack<Result>(
  run: (stack: RunningStack) => Promise<Result>,
): Promise<Result> {
  const projectName = `pepys-stack-${crypto.randomUUID().slice(0, 8)}`;
  const s2Port = readFreePort();

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
      .env({ ...process.env, S2_LITE_PORT: String(s2Port) })
      .quiet();

  let settled: { ok: true; value: Result } | { ok: false; error: unknown };

  try {
    const foreign = await readProjectResources(projectName);

    if (foreign !== '') {
      throw new Error(
        `Docker already holds resources for ${projectName}, so the stack refuses them`,
      );
    }

    // Every resource under this project name from here on is this run's, since none existed before.
    await startStack(compose, stopController.signal, s2Port);

    const value = await run({
      s2Endpoint: `http://127.0.0.1:${s2Port}`,
      s2AccessToken: 'ignored',
      s2Basin: 'pepys-local',
      stop: stopController.signal,
    });

    settled = { ok: true, value };
  } catch (error: unknown) {
    settled = { ok: false, error };
  }

  try {
    await compose(['down', '--volumes', '--remove-orphans']);

    console.error(`removed compose project ${projectName}`);
  } catch (error: unknown) {
    console.error(`could not remove compose project ${projectName}`, error);
  }

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

function readFreePort(): number {
  const listener = Bun.listen({
    hostname: '127.0.0.1',
    port: 0,
    socket: { data: () => {} },
  });

  const port = listener.port;

  listener.stop(true);

  return port;
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

// Invented local fixtures, matching compose.yaml.
const garageKeyID = 'GK000000000000000000000000';
const garageSecretKey = 'eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
const garageBucket = 'facts';

async function createGarageBucket(compose: Compose, stop: AbortSignal): Promise<void> {
  const runGarage = (args: readonly string[]): Promise<$.ShellOutput> =>
    compose(['exec', '-T', 'garage', '/garage', ...args]);

  const nodeID = await waitForGarageNodeID(runGarage, stop);

  await runGarage(['layout', 'assign', '-z', 'dc1', '-c', '1G', nodeID]);
  await runGarage(['layout', 'apply', '--version', '1']);
  await runGarage(['bucket', 'create', garageBucket]);
  await runGarage(['key', 'import', '--yes', '-n', 's2-lite', garageKeyID, garageSecretKey]);

  await runGarage([
    'bucket',
    'allow',
    '--read',
    '--write',
    '--owner',
    garageBucket,
    '--key',
    's2-lite',
  ]);
}

const healthTimeoutMs = 60_000;

async function waitForGarageNodeID(
  runGarage: (args: readonly string[]) => Promise<$.ShellOutput>,
  stop: AbortSignal,
): Promise<string> {
  const deadline = Date.now() + healthTimeoutMs;

  while (Date.now() < deadline) {
    stop.throwIfAborted();

    const output = await runGarage(['node', 'id', '-q']).then(
      (result) => result.stdout.toString(),
      () => '',
    );

    const [nodeID] = output.trim().split('@');

    if (nodeID !== undefined && nodeID !== '') {
      return nodeID;
    }

    await Bun.sleep(250);
  }

  throw new Error('Garage did not report a node ID before the deadline');
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
