import { checkDeployment, listReceiveRoutes } from '@pepys/kit';
import type { Deployment, SourceDefinition, StreamName } from '@pepys/kit';
import { makeShutdownHandler } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { readIngestConfig } from '../config/read-ingest-config.ts';
import { createS2FactLog } from '../fact-log/s2/create-s2-fact-log.ts';
import { createIngest } from '../receive/create-ingest.ts';
import { noSenderProof } from '../sender-proof/none/no-sender-proof.ts';
import { startPullTimers } from './start-pull-timers.ts';

interface ServeIngestOptions {
  deployment: Deployment;
  environment: Readonly<Record<string, string | undefined>>;
}

// The ingest process of a deployment. It exits 1 at start on a failed deployment check or on any
// missing variable, so no route ever runs with an empty secret.
export async function serveIngest(options: ServeIngestOptions): Promise<void> {
  const checked = checkDeployment(options.deployment);

  if (!checked.ok) {
    console.error('the deployment fails its check', JSON.stringify(checked.failure));
    process.exit(1);
  }

  const sources = checked.value.sources;
  const config = readIngestConfig(options.environment, collectSecretNames(sources));

  if (!config.ok) {
    console.error(config.failure.join('\n'));
    process.exit(1);
  }

  // The S2 adapter creates the basin and each missing stream, so no setup command creates streams.
  const log = await createS2FactLog({ ...config.value.s2, streams: collectStreams(sources) });

  // No adapter verifies a sender yet, so a path that needs one refuses every delivery.
  const ingest = createIngest({
    deployment: checked.value,
    secrets: config.value.secrets,
    log,
    senderProof: noSenderProof,
    appendRetry: { maxAttempts: 5, retryDelayMs: 200 },
    now: () => Date.now(),
  });

  for (const route of listReceiveRoutes(options.deployment)) {
    console.log(`route ${route.route}`, JSON.stringify(route));
  }

  const stopPulls = startPullTimers(sources, ingest.runPull);

  const server = Bun.serve({
    hostname: config.value.host,
    port: config.value.port,
    fetch: ingest.handleRequest,
  });

  console.log(`ingest listening on ${server.hostname}:${server.port}`);

  const shutdown = makeShutdownHandler({
    stop: () => {
      stopPulls();

      return server.stop();
    },
    logError: (message, error) => {
      console.error(message, error);
    },
    exit: (code) => process.exit(code),
  });

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void shutdown();
    });
  }
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
