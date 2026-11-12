import { checkDeployment, createLogger, listReceiveRoutes } from '@pepys/kit';
import type { Deployment, SourceDefinition, StreamName } from '@pepys/kit';
import { makeShutdownHandler } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { readIngestConfig } from '../config/read-ingest-config.ts';
import { createS2FactLog } from '../fact-log/s2/create-s2-fact-log.ts';
import { createIngest } from '../receive/create-ingest.ts';
import { readImpIdentitySenderProof } from '../sender-proof/imp-identity/read-imp-identity-sender-proof.ts';
import { startPullTimers } from './start-pull-timers.ts';

interface ServeIngestOptions {
  deployment: Deployment;
  environment: Readonly<Record<string, string | undefined>>;

  // false leaves SIGINT and SIGTERM to the caller, who stops ingest through the returned function
  exitOnSignal?: boolean;
}

// The ingest process of a deployment. It exits 1 at start on a failed deployment check, on any
// missing variable, or on a trust folder it cannot load, so no route ever runs with an empty secret.
// A path whose trust documents or audience are unset starts, and refuses every delivery.
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

  // The S2 adapter creates the basin and each missing stream, so no setup command creates streams.
  const log = await createS2FactLog({
    ...config.value.s2,
    streams: collectStreams(sources),
    logger,
  });

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

  const stopPulls = startPullTimers(sources, ingest.runPull, logger);

  console.log(`ingest listening on ${server.hostname}:${server.port}`);

  const stop = async (): Promise<void> => {
    await stopPulls();

    await server.stop();
  };

  if (options.exitOnSignal === false) {
    return stop;
  }

  const shutdown = makeShutdownHandler({
    stop,
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
