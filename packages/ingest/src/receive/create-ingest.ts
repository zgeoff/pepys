import type { CheckedDeployment, SenderProof } from '@pepys/kit';
import type { FactLog } from '../fact-log/fact-log.ts';
import { makeBatchAppender } from '../fact-log/make-batch-appender.ts';
import { buildFailureAnswer } from './answers/build-failure-answer.ts';
import { makeIgnoredRouteHandler, makeReceiveHandler } from './make-receive-handler.ts';
import { createRecentBodies } from './recent-bodies/create-recent-bodies.ts';
import { createResyncMarks } from './resync-marks/create-resync-marks.ts';
import type { ResyncMarks } from './resync-marks/create-resync-marks.ts';
import type { StreamTurns } from './write-batch.ts';

export interface IngestOptions {
  deployment: CheckedDeployment;

  // one value per `check.secretEnv` of the deployment; a missing or empty one refuses every delivery
  secrets: Readonly<Record<string, string>>;
  log: FactLog;
  senderProof: SenderProof;
  appendRetry: { maxAttempts: number; retryDelayMs: number };
  now: () => number;
}

export interface Ingest {
  // every receive route of the deployment; any other path answers 404
  handleRequest: (request: Request) => Promise<Response>;

  // what a source's resync pull reads
  resyncMarks: ResyncMarks;
}

const recentBodyCapacity = 10_000;
const recentBodyMaxAgeMs = 3_600_000;

// The receive routes of a deployment over a given log, as one fetch function with no listener.
export function createIngest(options: IngestOptions): Ingest {
  const append = makeBatchAppender({ log: options.log, ...options.appendRetry });

  const turns: StreamTurns = new Map();

  const resync = createResyncMarks({ capacity: recentBodyCapacity });

  const handlers = new Map<string, (request: Request) => Promise<Response>>();

  for (const source of options.deployment.sources) {
    const path = source.live;

    if (path?.kind !== 'receive') {
      continue;
    }

    const secret = options.secrets[path.check.secretEnv] ?? '';

    handlers.set(
      path.route,
      makeReceiveHandler(source, path, {
        secret,
        senderProof: options.senderProof,
        append,
        turns,
        recentBodies: createRecentBodies({
          capacity: recentBodyCapacity,
          maxAgeMs: recentBodyMaxAgeMs,
          now: options.now,
        }),
        marks: source.resync === undefined ? null : resync.createSourceMarks(source.name),
      }),
    );

    for (const route of path.ignoredRoutes ?? []) {
      handlers.set(
        route,
        makeIgnoredRouteHandler(path, { secret, senderProof: options.senderProof }),
      );
    }
  }

  return {
    handleRequest: async (request) => {
      const handler = handlers.get(new URL(request.url).pathname);

      return handler === undefined ? buildFailureAnswer(404, 'not found') : await handler(request);
    },
    resyncMarks: resync.marks,
  };
}
