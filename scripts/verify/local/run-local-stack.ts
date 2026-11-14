import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { join } from 'node:path';
import { serveAPI } from '@pepys/api';
import { serveIngest } from '@pepys/ingest';
import { e2eDeployment } from '../../../packages/cli/e2e/fixtures/e2e-deployment.ts';
import { startE2EStack } from '../../../packages/cli/src/test-utils/start-e2e-stack.ts';
import { StackInterruptedError } from '../../../stack/stack-interrupted-error.ts';
import { createHostProcess } from './create-host-process.ts';
import { serveControl } from './serve-control.ts';

// The `local` target's app: the e2e deployment, with ingest and the API in this process and the host
// as a child that the control server stops and starts. It prints one ready line, runs until SIGTERM
// or SIGINT, then removes everything it started.
export async function runLocalStack(runDirectory: string): Promise<number> {
  const stopRequested = Promise.withResolvers<void>();

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      stopRequested.resolve();
    });
  }

  const cleanup = new AsyncDisposableStack();

  try {
    await runParts(cleanup, runDirectory, stopRequested.promise);
  } catch (error) {
    if (!(error instanceof StackInterruptedError)) {
      process.stderr.write(`verify local: the start failed: ${String(error)}\n`);
    }
  }

  return closeParts(cleanup);
}

async function runParts(
  cleanup: AsyncDisposableStack,
  runDirectory: string,
  stopRequested: Promise<void>,
): Promise<void> {
  const startedAt = performance.now();

  const started = await startE2EStack(cleanup);

  const stopIngest = await serveIngest({
    deployment: e2eDeployment,
    environment: started.environment,
    exitOnSignal: false,
  });

  cleanup.defer(stopIngest);

  const stopAPI = await serveAPI({
    deployment: e2eDeployment,
    environment: started.environment,
    exitOnSignal: false,
  });

  cleanup.defer(stopAPI);

  const hostLogPath = join(runDirectory, 'host.log');
  const hostLog = createWriteStream(hostLogPath, { flags: 'a' });

  cleanup.defer(() => closeWriteStream(hostLog));

  const host = createHostProcess(() => {
    const child = Bun.spawn([started.hostBinary, 'run', '--up'], {
      env: started.environment,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    void copyOutput(child.stdout, hostLog);
    void copyOutput(child.stderr, hostLog);

    return child;
  });

  cleanup.defer(async () => {
    await host.stop();
  });

  host.start();

  const control = serveControl({ host, issuer: started.issuer });

  cleanup.defer(() => control.stop(true));

  const startMs = Math.round(performance.now() - startedAt);

  const ready = JSON.stringify({
    event: 'ready',
    ingest: started.ingestURL,
    api: started.apiURL,
    control: control.url.origin,
    s2: started.stack.s2Endpoint,
    s2Basin: started.stack.s2Basin,
    s2Token: started.stack.s2AccessToken,
    garage: started.stack.garage.endpoint,
    project: started.stack.project,
    store: started.storeDirectory,
    hostLog: hostLogPath,
    startMs: String(startMs),
  });

  process.stdout.write(`${ready}\n`);

  await stopRequested;
}

function closeWriteStream(stream: WriteStream): Promise<void> {
  const closed = Promise.withResolvers<void>();

  stream.end(() => {
    closed.resolve();
  });

  return closed.promise;
}

// The host's output goes to its own log, for the `host` stream, and to this process's stderr, for
// the run's app log.
async function copyOutput(output: ReadableStream<Uint8Array>, hostLog: WriteStream): Promise<void> {
  for await (const chunk of output) {
    hostLog.write(chunk);
    process.stderr.write(chunk);
  }
}

// Runs every cleanup step, the compose project's removal last, and returns the exit code.
async function closeParts(cleanup: AsyncDisposableStack): Promise<number> {
  try {
    await cleanup.disposeAsync();

    return 0;
  } catch (error) {
    if (error instanceof StackInterruptedError) {
      return 0;
    }

    process.stderr.write(`verify local: a part failed to stop: ${String(error)}\n`);

    return 1;
  }
}

if (import.meta.main) {
  const runDirectory = process.argv.at(2);

  if (runDirectory === undefined) {
    process.stderr.write('usage: run-local-stack.ts <run directory>\n');
    process.exit(2);
  }

  const exitCode = await runLocalStack(runDirectory);

  process.exit(exitCode);
}
