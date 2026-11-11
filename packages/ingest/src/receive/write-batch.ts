import type { StreamName } from '@pepys/kit';
import type { BatchAppender } from '../fact-log/make-batch-appender.ts';
import type { BatchPlan } from './plan-batch.ts';

export type BatchOutcome = 'stored' | 'refused' | 'not-stored';

// One chain of turns per stream, for the whole process. A delivery holds a stream's turn for all of
// its appends on that stream, so the appends of two deliveries never interleave.
export type StreamTurns = Map<StreamName, Promise<void>>;

interface WriteBatchDependencies {
  append: BatchAppender;
  turns: StreamTurns;
}

// The streams append at the same time, and the appends of one stream one after the other. Every
// stream settles before the answer, so a failure on one stream never leaves another in flight.
export async function writeBatch(
  plan: BatchPlan,
  dependencies: WriteBatchDependencies,
): Promise<BatchOutcome> {
  const settled = await Promise.all(
    [...plan].map(([stream, runs]) =>
      withStreamTurn(dependencies.turns, stream, async () => {
        for (const run of runs) {
          const appended = await dependencies.append(stream, run);

          if (!appended.ok) {
            console.error(`an append to ${stream} failed`, appended.failure);

            return appended.failure.kind;
          }
        }

        return 'stored' as const;
      }),
    ),
  );

  return pickBatchOutcome(settled);
}

// A throw is a refusal the log gives no outcome for, such as a bad access token.
async function withStreamTurn(
  turns: StreamTurns,
  stream: StreamName,
  work: () => Promise<BatchOutcome>,
): Promise<BatchOutcome> {
  const previous = turns.get(stream) ?? Promise.resolve();
  const done = Promise.withResolvers<void>();

  turns.set(stream, done.promise);

  try {
    await previous;

    return await work();
  } catch (error: unknown) {
    console.error(`an append to ${stream} threw`, error);

    return 'refused';
  } finally {
    done.resolve();

    if (turns.get(stream) === done.promise) {
      turns.delete(stream);
    }
  }
}

// A refusal wins over `not-stored`: a repeat cannot mend it, so the sender must not be told to
// repeat.
function pickBatchOutcome(settled: readonly BatchOutcome[]): BatchOutcome {
  if (settled.includes('refused')) {
    return 'refused';
  }

  return settled.includes('not-stored') ? 'not-stored' : 'stored';
}
