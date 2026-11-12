import type { Logger, SourceDefinition } from '@pepys/kit';
import { match } from 'ts-pattern';
import type { PullPathName, PullRun, PullRunner } from '../pull/make-pull-runner.ts';

const pullPathNames: readonly PullPathName[] = ['live', 'recovery', 'backfill', 'resync'];

// One timer per pull path with an interval. The cursor lives in memory, so a restart starts each
// pull from no cursor. A run never overlaps the one before it. Returns the function that stops them:
// it aborts each run in flight and settles once every run has ended.
export function startPullTimers(
  sources: readonly SourceDefinition[],
  runPull: PullRunner,
  logger: Logger,
): () => Promise<void> {
  const controller = new AbortController();
  const activeRuns = new Set<Promise<void>>();

  const timers = sources.flatMap((source) =>
    pullPathNames.flatMap((pathName) => {
      const path = source[pathName];

      if (path?.kind !== 'pull' || path.intervalMs === null) {
        return [];
      }

      let cursor: string | null = null;
      let isRunning = false;

      const runOnce = async (): Promise<void> => {
        if (isRunning || controller.signal.aborted) {
          return;
        }

        isRunning = true;

        const ended = Promise.withResolvers<void>();

        activeRuns.add(ended.promise);

        try {
          const run = await runPull(source.name, pathName, cursor, controller.signal);

          cursor = pickNextCursor(run, cursor);

          if (run.kind !== 'stored') {
            logger.error(`the ${pathName} pull of ${source.name} did not store`, run);
          }
        } catch (error: unknown) {
          logger.error(`the ${pathName} pull of ${source.name} threw`, error);
        } finally {
          isRunning = false;

          activeRuns.delete(ended.promise);
          ended.resolve();
        }
      };

      return [
        setInterval(() => {
          void runOnce();
        }, path.intervalMs),
      ];
    }),
  );

  return async () => {
    for (const timer of timers) {
      clearInterval(timer);
    }

    controller.abort();

    await Promise.all(activeRuns);
  };
}

// An expired cursor starts the pull again from none; any other failure keeps the cursor.
function pickNextCursor(run: PullRun, cursor: string | null): string | null {
  return match(run)
    .with({ kind: 'stored' }, (stored) => stored.cursor)
    .with({ kind: 'expired' }, () => null)
    .with({ kind: 'not-stored' }, { kind: 'refused' }, { kind: 'unavailable' }, () => cursor)
    .with({ kind: 'rejected' }, () => cursor)
    .exhaustive();
}
