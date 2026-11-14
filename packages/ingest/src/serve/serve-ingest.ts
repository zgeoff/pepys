import { setTimeout as wait } from 'node:timers/promises';
import { checkDeployment, createLogger, listReceiveRoutes } from '@pepys/kit';
import type { Deployment, SourceDefinition, StreamName } from '@pepys/kit';
import { makeShutdownHandler } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { readIngestConfig } from '../config/read-ingest-config.ts';
import { createS2FactLog } from '../fact-log/s2/create-s2-fact-log.ts';
import { collectTimedPulls } from '../pull/collect-timed-pulls.ts';
import { cursorStream } from '../pull/cursors/cursor-stream.ts';
import { formatPullStart } from '../pull/cursors/format-pull-start.ts';
import { readSavedCursors } from '../pull/cursors/read-saved-cursors.ts';
import { createIngest } from '../receive/create-ingest.ts';
import { readImpIdentitySenderProof } from '../sender-proof/imp-identity/read-imp-identity-sender-proof.ts';
import { runStartWithRetry } from './run-start-with-retry.ts';
import { startPullTimers } from './start-pull-timers.ts';

interface ServeIngestOptions {
  deployment: Deployment;
  environment: Readonly<Record<string, string | undefined>>;

  // false leaves SIGINT and SIGTERM to the caller, who stops ingest through the returned function
  exitOnSignal?: boolean;

  // aborts a start that still waits for the fact log, for a caller that owns the stop signals
  signal?: AbortSignal;
}

// The ingest process of a deployment. It exits 1 at start on a failed deployment check, a missing
// variable, or a trust folder it cannot load, so no route ever runs with an empty secret. A stop
// before ingest listens ends the start, and the returned function then stops nothing.
export async function serveIngest(options: ServeIngestOptions): Promise<() => Promise<void>> {
  const logger = createLogger(process.stderr);
  const checked = checkDeployment(options.deployment);

  if (!checked.ok) {
    logger.error('the deployment fails its check', checked.failure);
    process.exit(1);
  }

  const sources = checked.value.sources;
  const config = readIngestConfig(options.environment, collectSecretNames(sources));

  if (!config.ok) {
    logger.error('the ingest config is incomplete', config.failure);
    process.exit(1);
  }

  const senderProof = await readImpIdentitySenderProof({
    sources,
    environment: options.environment,
    now: () => Date.now(),
    logger,
  });

  if (!senderProof.ok) {
    logger.error('the sender proof cannot start', senderProof.failure);
    process.exit(1);
  }

  const starting = new AbortController();

  let stop = (): Promise<void> => {
    starting.abort();

    return Promise.resolve();
  };

  if (options.exitOnSignal !== false) {
    const shutdown = makeShutdownHandler({
      stop: () => stop(),
      logError: (message, error) => {
        logger.error(message, error);
      },
      exit: (code) => process.exit(code),
    });

    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        void shutdown();
      });
    }
  }

  // The S2 adapter creates the basin and each missing stream, so no setup command creates streams.
  const started = await runStartWithRetry(
    async () => {
      const log = await createS2FactLog({
        ...config.value.s2,
        streams: [...collectStreams(sources), cursorStream],
        logger,
      });

      return { log, pulls: await readSavedCursors(log, collectTimedPulls(sources)) };
    },
    {
      wait,
      signal:
        options.signal === undefined
          ? starting.signal
          : AbortSignal.any([starting.signal, options.signal]),
      logger,
    },
  );

  if (started.kind === 'stopped') {
    return () => Promise.resolve();
  }

  if (started.kind === 'failed') {
    logger.error('the fact log failed the start of ingest', started.error);
    process.exit(1);
  }

  const log = started.value.log;
  const pulls = started.value.pulls;

  const ingest = createIngest({
    deployment: checked.value,
    secrets: config.value.secrets,
    log,
    senderProof: senderProof.value,
    appendRetry: { maxAttempts: 5, retryDelayMs: 200 },
    now: () => Date.now(),
    logger,
  });

  for (const route of listReceiveRoutes(options.deployment)) {
    console.log(`route ${route.route}`, JSON.stringify(route));
  }

  // The server starts first, so a failed listen leaves no timer behind.
  const server = Bun.serve({
    hostname: config.value.host,
    port: config.value.port,
    fetch: ingest.handleRequest,
  });

  for (const pull of pulls) {
    console.log(formatPullStart(pull));
  }

  const stopPulls = startPullTimers(pulls, ingest.runPull, logger);

  console.log(`ingest listening on ${server.hostname}:${server.port}`);

  stop = async (): Promise<void> => {
    await stopPulls();

    await server.stop();
  };

  return stop;
}

// every receive path's secret, and every name a pull path's `env` lists
function collectSecretNames(sources: readonly SourceDefinition[]): string[] {
  const names = sources.flatMap((source) => [
    ...(source.live?.kind === 'receive' ? [source.live.check.secretEnv] : []),
    ...[source.live, source.recovery, source.backfill, source.resync].flatMap((path) =>
      path?.kind === 'pull' ? (path.env ?? []) : [],
    ),
  ]);

  return [...new Set(names)];
}

function collectStreams(sources: readonly SourceDefinition[]): StreamName[] {
  const streams = sources.flatMap((source) => source.families.map((family) => family.stream));

  return [...new Set(streams)].map((stream) => toTagged<StreamName>(stream));
}
