import type { CheckedDeployment, PullPath, Pulled, SourceDefinition } from '@pepys/kit';
import type { BatchAppender } from '../fact-log/make-batch-appender.ts';
import { findBatchProblem } from '../receive/find-batch-problem.ts';
import { planBatch } from '../receive/plan-batch.ts';
import type { ResyncMarks } from '../receive/resync-marks/create-resync-marks.ts';
import { writeBatch } from '../receive/write-batch.ts';
import type { StreamTurns } from '../receive/write-batch.ts';

export type PullPathName = 'live' | 'recovery' | 'backfill' | 'resync';

// `stored`: the batch is in the log, and the next run starts from `cursor`. `not-stored`: an append
// failed, so the next run starts from the same cursor. Any other answer is the pull's own.
export type PullRun =
  | { kind: 'stored'; stored: number; cursor: string; isDone: boolean }
  | { kind: 'not-stored' }
  | { kind: 'refused'; reason: string }
  | Exclude<Pulled, { kind: 'batch' }>;

export type PullRunner = (
  source: string,
  path: PullPathName,
  cursor: string | null,
) => Promise<PullRun>;

interface PullRunnerDependencies {
  deployment: CheckedDeployment;

  // one value per name that a pull path's `env` lists
  secrets: Readonly<Record<string, string>>;
  append: BatchAppender;
  turns: StreamTurns;
  resyncMarks: ResyncMarks;
  now: () => number;
}

// For a resync pull, removes each mark it was given that no tie set again since. A pull's fact is
// noted in no mark: a resynced fact ties with the body it replaces, and would mark its entity again
// on every run.
export function makePullRunner(dependencies: PullRunnerDependencies): PullRunner {
  return async (sourceName, pathName, cursor) => {
    const source = dependencies.deployment.sources.find(
      (candidate) => candidate.name === sourceName,
    );

    const path = source === undefined ? undefined : findPullPath(source, pathName);

    if (source === undefined || path === undefined) {
      return { kind: 'refused', reason: `the source ${sourceName} has no ${pathName} pull` };
    }

    const marks = pathName === 'resync' ? dependencies.resyncMarks.list(source.name) : [];
    const env: Record<string, string> = {};

    for (const name of path.env ?? []) {
      env[name] = dependencies.secrets[name] ?? '';
    }

    const pulled = await path.pull(cursor, { env, marks, now: dependencies.now });

    if (pulled.kind !== 'batch') {
      return pulled;
    }

    const problem = findBatchProblem(source, pulled.batch);

    if (problem !== undefined) {
      return { kind: 'refused', reason: problem };
    }

    if (pulled.batch.facts.some((pending) => pending.blobs.length > 0)) {
      return { kind: 'refused', reason: 'ingest has no blob store' };
    }

    const plan = planBatch(pulled.batch);

    if (!plan.ok) {
      return { kind: 'refused', reason: 'one fact is larger than one append of the log takes' };
    }

    const outcome = await writeBatch(plan.value, dependencies);

    if (outcome !== 'stored') {
      return outcome === 'not-stored'
        ? { kind: 'not-stored' }
        : { kind: 'refused', reason: 'the log refused the batch' };
    }

    for (const mark of marks) {
      dependencies.resyncMarks.remove(source.name, mark);
    }

    return {
      kind: 'stored',
      stored: pulled.batch.facts.length,
      cursor: pulled.cursor,
      isDone: pulled.isDone,
    };
  };
}

function findPullPath(source: SourceDefinition, pathName: PullPathName): PullPath | undefined {
  const path = source[pathName];

  return path?.kind === 'pull' ? path : undefined;
}
