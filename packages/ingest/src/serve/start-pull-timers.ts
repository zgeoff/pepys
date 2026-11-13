import type { Logger } from '@pepys/kit';
import { match } from 'ts-pattern';
import type { ResumedPull } from '../pull/cursors/read-saved-cursors.ts';
import type { PullRun, PullRunner } from '../pull/make-pull-runner.ts';

// One timer per pull, whose first run starts from the pull's saved cursor. A run never overlaps the
// one before it on the same timer. Returns the function that stops the timers: it aborts each run
// in flight and settles once every run has ended.
export function startPullTimers(
  pulls: readonly ResumedPull[],
  runPull: PullRunner,
  logger: Logger,
): () => Promise<void> {
  const controller = new AbortController();
  const activeRuns = new Set<Promise<void>>();

  const timers = pulls.map((pull) => {
    let cursor = pull.cursor;
    let isRunning = false;

    const runOnce = async (): Promise<void> => {
      if (isRunning || controller.signal.aborted) {
        return;
      }

      isRunning = true;

      const ended = Promise.withResolvers<void>();

      activeRuns.add(ended.promise);

      try {
        const run = await runPull(pull.source, pull.path, cursor, controller.signal);

        cursor = pickNextCursor(run, cursor);

        // a run that the stop cut short is no failure
        if (run.kind !== 'stored' && !controller.signal.aborted) {
          logger.error(`the ${pull.path} pull of ${pull.source} did not store`, run);
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          logger.error(`the ${pull.path} pull of ${pull.source} threw`, error);
        }
      } finally {
        isRunning = false;

        activeRuns.delete(ended.promise);
        ended.resolve();
      }
    };

    return setInterval(() => {
      void runOnce();
    }, pull.intervalMs);
  });

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
