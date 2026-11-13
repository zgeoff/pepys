import type { EntityID, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import type { FactLog } from '../../fact-log/fact-log.ts';
import { readRun } from '../../fact-log/read-run.ts';
import type { TimedPull } from '../collect-timed-pulls.ts';
import { buildCursorEntity } from './build-cursor-entity.ts';
import { cursorStream } from './cursor-stream.ts';

export interface ResumedPull extends TimedPull {
  // the last cursor that the log holds for the pull path, or null when it holds none
  cursor: string | null;
}

const pageSize = 1000;

// Gives each pull the cursor of its newest record in the cursor stream. Reads the stream from its
// tail towards its start, one page at a time, and stops once every pull has its cursor.
export async function readSavedCursors(
  log: FactLog,
  pulls: readonly TimedPull[],
): Promise<ResumedPull[]> {
  const tail = await log.readTail(cursorStream);

  invariant(tail.ok, 'the log holds the cursor stream');

  const wanted = new Set(pulls.map((pull) => buildCursorEntity(pull.source, pull.path)));
  const saved = new Map<EntityID, string>();

  let end: number = tail.value;

  while (end > 0 && saved.size < wanted.size) {
    const from = Math.max(0, end - pageSize);

    const page = await readRun(log, cursorStream, toTagged<StreamOffset>(from), end - from);

    invariant(page.ok, 'the log holds the cursor stream');

    for (const stored of page.value.toReversed()) {
      const entity = stored.fact.entity;
      const cursor = stored.fact.cursor;

      if (cursor !== undefined && wanted.has(entity) && !saved.has(entity)) {
        saved.set(entity, cursor);
      }
    }

    end = from;
  }

  return pulls.map((pull) => ({
    ...pull,
    cursor: saved.get(buildCursorEntity(pull.source, pull.path)) ?? null,
  }));
}
