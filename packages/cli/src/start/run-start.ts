import { serveAPI } from '@pepys/api';
import { serveIngest } from '@pepys/ingest';
import type { Deployment } from '@pepys/kit';
import { createActor, toPromise } from 'xstate';
import type { Actor } from 'xstate';
import { loadBuildFile } from '../build/load-build-file.ts';
import { pickHostBinary } from './pick-host-binary.ts';
import { pickStartDeployment } from './pick-start-deployment.ts';
import { startMachine } from './start-machine.ts';

export interface StartOptions {
  file: string;
  environment: Readonly<Record<string, string | undefined>>;
}

// Returns the exit code. Ingest and the API start first, and the host last, so a part that refuses
// to start leaves no host running. The stop signals are handled from the first line: one that
// arrives while a part is starting lets that part finish, then stops every started part.
export async function runStart(options: StartOptions): Promise<number> {
  const stopRequest = makeStopRequest();

  try {
    return await runParts(options, stopRequest);
  } finally {
    stopRequest.remove();
  }
}

interface StopRequest {
  isRequested: () => boolean;

  // runs now if a stop was requested already, and on the next request otherwise
  onRequest: (listener: () => void) => void;
  remove: () => void;
}

function makeStopRequest(): StopRequest {
  let isRequested = false;
  let listener: (() => void) | null = null;

  const onSignal = (): void => {
    isRequested = true;
    listener?.();
  };

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  return {
    isRequested: () => isRequested,
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
}

const startOrder = [startIngest, startAPI, startHost];

async function runParts(options: StartOptions, stopRequest: StopRequest): Promise<number> {
  const host = pickHostBinary(options.environment);

  if (!host.ok) {
    process.stderr.write(`${host.failure}\n`);

    return 1;
  }

  const loaded = await loadBuildFile(options.file);

  const deployment = pickStartDeployment(loaded);

  if (!deployment.ok) {
    process.stderr.write(`${deployment.failure}\n`);

    return 1;
  }

  const context: PartContext = {
    deployment: deployment.value,
    environment: options.environment,
    hostBinary: host.value,
  };

  const started: StartedPart[] = [];

  try {
    for (const startPart of startOrder) {
      if (stopRequest.isRequested()) {
        break;
      }

      const part = await startPart(context);

      started.push(part);
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

// Ingest and the API run in this process, so this process owns the stop signals.
async function startIngest(context: PartContext): Promise<StartedPart> {
  const stop = await serveIngest({
    deployment: context.deployment,
    environment: context.environment,
    exitOnSignal: false,
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
