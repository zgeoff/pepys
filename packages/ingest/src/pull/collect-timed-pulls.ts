import type { SourceDefinition } from '@pepys/kit';
import type { PullPathName } from './make-pull-runner.ts';

export interface TimedPull {
  source: string;
  path: PullPathName;
  intervalMs: number;
}

const pullPathNames: readonly PullPathName[] = ['live', 'recovery', 'backfill', 'resync'];

// Every pull path that sets an interval, in the order of the sources and then of the slots.
export function collectTimedPulls(sources: readonly SourceDefinition[]): TimedPull[] {
  return sources.flatMap((source) =>
    pullPathNames.flatMap((pathName) => {
      const path = source[pathName];

      return path?.kind === 'pull' && path.intervalMs !== null
        ? [{ source: source.name, path: pathName, intervalMs: path.intervalMs }]
        : [];
    }),
  );
}
