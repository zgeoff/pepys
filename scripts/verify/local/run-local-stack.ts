import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveAPI } from '@pepys/api';
import { serveIngest } from '@pepys/ingest';
import { e2eDeployment } from '../../../packages/cli/e2e/fixtures/e2e-deployment.ts';
import { startE2EStack } from '../../../packages/cli/e2e/fixtures/start-e2e-stack.ts';
import { StackInterruptedError } from '../../../stack/stack-interrupted-error.ts';
import { createHostProcess } from './create-host-process.ts';
import { serveControl } from './serve-control.ts';
import { writeServiceTokenFile } from './write-service-token-file.ts';

interface LocalRun {
  readonly runDirectory: string;

  // the sha256 digest of the run's service client secret, which the launch minted
  readonly digest: string;
}

// The `local` target's app: the e2e deployment, with ingest and the API in this process and the host
// as a child that the control server stops and starts. It prints one ready line, runs until SIGTERM
// or SIGINT, then removes everything it started.
export async function runLocalStack(run: LocalRun): Promise<number> {
  const stopController = new AbortController();

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      stopController.abort();
    });
  }

  const cleanup = new AsyncDisposableStack();

  try {
    await runParts(cleanup, run, stopController.signal);
  } catch (error) {
    if (!(error instanceof StackInterruptedError)) {
      process.stderr.write(`verify local: the start failed: ${String(error)}\n`);
    }
  }

  return closeParts(cleanup);
}

async function runParts(
  cleanup: AsyncDisposableStack,
  run: LocalRun,
  stopSignal: AbortSignal,
): Promise<void> {
  const startedAt = performance.now();

  const started = await startE2EStack(cleanup);

  // ingest retries the fact log at start, so a stop then must end its wait, or the SIGKILL that
  // follows SIGTERM lands before the cleanup removes the compose project
  const stopIngest = await serveIngest({
    deployment: e2eDeployment,
    environment: started.environment,
    exitOnSignal: false,
    signal: stopSignal,
  });

  cleanup.defer(stopIngest);

  if (stopSignal.aborted) {
    return;
  }

  // The API serves /mcp on its loopback origin, behind its OAuth server, with the run's one service
  // client in a service-token file. The OAuth database and the file go when the run ends.
  const authDirectory = await mkdtemp(join(tmpdir(), 'pepys-verify-auth-'));

  cleanup.defer(() => rm(authDirectory, { recursive: true, force: true }));

  const serviceTokensFile = await writeServiceTokenFile(authDirectory, started.apiURL, run.digest);

  const stopAPI = await serveAPI({
    deployment: e2eDeployment,
    environment: {
      ...started.environment,
      PEPYS_API_PUBLIC_URL: started.apiURL,
      PEPYS_AUTH_DIR: authDirectory,
      PEPYS_API_SERVICE_TOKENS_FILE: serviceTokensFile,
    },
    exitOnSignal: false,
  });

  cleanup.defer(stopAPI);

  const hostLogPath = join(run.runDirectory, 'host.log');
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
    mcp: started.apiURL,
    control: control.url.origin,
    s2: started.stack.s2Endpoint,
    s2Basin: started.stack.s2Basin,
    s2Token: started.stack.s2AccessToken,
    garage: started.stack.garage.endpoint,
    project: started.stack.project,
    store: started.storeDirectory,
    hostLog: hostLogPath,
    serviceTokens: serviceTokensFile,
    startMs: String(startMs),
  });

  process.stdout.write(`${ready}\n`);

  await waitForAbort(stopSignal);
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

function waitForAbort(signal: AbortSignal): Promise<void> {
  const aborted = Promise.withResolvers<void>();

  if (signal.aborted) {
    aborted.resolve();
  }

  signal.addEventListener('abort', () => {
    aborted.resolve();
  });

  return aborted.promise;
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
  const digest = process.argv.at(3);

  if (runDirectory === undefined || digest === undefined) {
    process.stderr.write('usage: run-local-stack.ts <run directory> <service secret digest>\n');
    process.exit(2);
  }

  const exitCode = await runLocalStack({ runDirectory, digest });

  process.exit(exitCode);
}
