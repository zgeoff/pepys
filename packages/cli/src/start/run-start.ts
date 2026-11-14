import { serveAPI } from '@pepys/api';
import { serveIngest } from '@pepys/ingest';
import type { Deployment } from '@pepys/kit';
import { createActor, toPromise } from 'xstate';
import type { Actor } from 'xstate';
import { loadBuildFile } from '../utils/load-build-file.ts';
import { pickHostBinary } from './pick-host-binary.ts';
import { pickStartDeployment } from './pick-start-deployment.ts';
import { startMachine } from './start-machine.ts';

export interface StartOptions {
  file: string;
  environment: Readonly<Record<string, string | undefined>>;
}

// Returns the exit code. Ingest and the API start first, and the host last, so a part that refuses
// to start leaves no host running. A stop signal during load or startup cancels it at once and
// stops every part already started.
export async function runStart(options: StartOptions): Promise<number> {
  const stopRequest = createStopRequest();

  try {
    return await runParts(options, stopRequest);
  } finally {
    stopRequest.remove();
  }
}

interface StopRequest {
  isRequested: () => boolean;
  requested: Promise<void>;

  // aborts on the first request
  signal: AbortSignal;

  // runs now if a stop was requested already, and on the next request otherwise
  onRequest: (listener: () => void) => void;
  remove: () => void;
}

function createStopRequest(): StopRequest {
  let isRequested = false;
  const requested = Promise.withResolvers<void>();

  const stopping = new AbortController();

  let listener: (() => void) | null = null;

  const onSignal = (): void => {
    isRequested = true;

    requested.resolve();
    stopping.abort();
    listener?.();
  };

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  return {
    isRequested: () => isRequested,
    requested: requested.promise,
    signal: stopping.signal,
    onRequest: (next) => {
      listener = next;

      if (isRequested) {
        next();
      }
    },
    remove: () => {
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    },
  };
}

// One part of a deployment. `stop` says whether the part stopped cleanly. `ended` settles with a
// line when the part ends on its own, and is absent for a part that runs in this process.
interface StartedPart {
  name: string;
  stop: () => Promise<boolean>;
  ended?: Promise<string>;
}

interface PartContext {
  deployment: Deployment;
  environment: StartOptions['environment'];
  hostBinary: string;

  // aborts when a stop is requested
  stopSignal: AbortSignal;
}

const startOrder = [startIngest, startAPI, startHost];

async function runParts(options: StartOptions, stopRequest: StopRequest): Promise<number> {
  const host = pickHostBinary(options.environment);

  if (!host.ok) {
    process.stderr.write(`${host.failure}\n`);

    return 1;
  }

  const loading = await runUntilStop(loadBuildFile(options.file), stopRequest);

  if (loading.isStopped) {
    return 0;
  }

  const loaded = loading.value;
  const deployment = pickStartDeployment(loaded);

  if (!deployment.ok) {
    process.stderr.write(`${deployment.failure}\n`);

    return 1;
  }

  const context: PartContext = {
    deployment: deployment.value,
    environment: options.environment,
    hostBinary: host.value,
    stopSignal: stopRequest.signal,
  };

  const started: StartedPart[] = [];

  try {
    for (const startPart of startOrder) {
      if (stopRequest.isRequested()) {
        break;
      }

      const starting = startPart(context);

      const result = await runUntilStop(starting, stopRequest);

      if (result.isStopped) {
        void stopLateStarter(starting);
        break;
      }

      started.push(result.value);
    }
  } catch (error) {
    process.stderr.write(`pepys start: a part failed to start: ${String(error)}\n`);

    await stopParts(started);

    return 1;
  }

  if (stopRequest.isRequested() && started.length < startOrder.length) {
    const isClean = await stopParts(started);

    return isClean ? 0 : 1;
  }

  return superviseParts(started, stopRequest);
}

type StopRace<T> = { isStopped: true } | { isStopped: false; value: T };

// The work keeps going after a stop, so the caller owns what it leaves behind.
function runUntilStop<T>(work: Promise<T>, stopRequest: StopRequest): Promise<StopRace<T>> {
  return Promise.race([waitForWork(work), waitForStop<T>(stopRequest)]);
}

async function waitForWork<T>(work: Promise<T>): Promise<StopRace<T>> {
  return { isStopped: false, value: await work };
}

async function waitForStop<T>(stopRequest: StopRequest): Promise<StopRace<T>> {
  await stopRequest.requested;

  return { isStopped: true };
}

// Ingest and the API run in this process, so this process owns the stop signals.
async function startIngest(context: PartContext): Promise<StartedPart> {
  const stop = await serveIngest({
    deployment: context.deployment,
    environment: context.environment,
    exitOnSignal: false,
    signal: context.stopSignal,
  });

  return { name: 'ingest', stop: () => stopInProcess(stop) };
}

async function stopInProcess(stop: () => Promise<void>): Promise<boolean> {
  await stop();

  return true;
}

async function startAPI(context: PartContext): Promise<StartedPart> {
  const stop = await serveAPI({
    deployment: context.deployment,
    environment: context.environment,
    exitOnSignal: false,
  });

  return { name: 'api', stop: () => stopInProcess(stop) };
}

// The host is a child process, so a stop reads its exit code. The `exit` listener is the backstop
// for a process that ends with the host still running.
function startHost(context: PartContext): Promise<StartedPart> {
  const child = Bun.spawn([context.hostBinary, 'run', '--up'], {
    env: { ...context.environment },
    stdout: 'inherit',
    stderr: 'inherit',
  });

  const killChild = (): void => {
    child.kill('SIGKILL');
  };

  process.on('exit', killChild);

  return Promise.resolve({
    name: 'host',
    ended: describeExit(child),
    stop: async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
      }

      const code = await child.exited;

      process.off('exit', killChild);

      return code === 0;
    },
  });
}

async function describeExit(child: Bun.Subprocess): Promise<string> {
  const code = await child.exited;

  return `exited with ${code}`;
}

// A part that was still starting when the stop came stops as soon as it is up.
async function stopLateStarter(starting: Promise<StartedPart>): Promise<void> {
  try {
    const part = await starting;

    await part.stop();
  } catch {
    // the part never came up, so there is nothing to stop
  }
}

// Stops every part, whether or not another part's stop fails.
async function stopParts(parts: readonly StartedPart[]): Promise<boolean> {
  const results = await Promise.allSettled(parts.map((part) => part.stop()));

  return results.every((result) => result.status === 'fulfilled' && result.value);
}

function superviseParts(parts: readonly StartedPart[], stopRequest: StopRequest): Promise<number> {
  const actor = createActor(startMachine, { input: { stopParts: () => stopParts(parts) } });

  for (const part of parts) {
    void watchPart(actor, part);
  }

  actor.start();

  stopRequest.onRequest(() => {
    actor.send({ type: 'signal' });
  });

  return toPromise(actor);
}

async function watchPart(actor: Actor<typeof startMachine>, part: StartedPart): Promise<void> {
  if (part.ended === undefined) {
    return;
  }

  const line = await part.ended;

  // a part that ends because this process stopped it is no news
  if (actor.getSnapshot().matches('running')) {
    process.stderr.write(`pepys start: ${part.name} ${line}\n`);
    actor.send({ type: 'part-ended' });
  }
}
