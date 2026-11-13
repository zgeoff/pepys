import { buildObservationFactID } from '@pepys/kit';
import type { FactEnvelope } from '@pepys/kit';
import type { PullPathName } from '../make-pull-runner.ts';
import { buildCursorEntity } from './build-cursor-entity.ts';

interface CursorPosition {
  source: string;
  path: PullPathName;
  cursor: string;
  nowMs: number;
}

// The record of one pull path's position, in the envelope of a fact so that the log takes it. The
// ID comes from the position alone, so a retry of the append is settled as the same record.
export function buildCursorRecord(position: CursorPosition): FactEnvelope<Record<string, never>> {
  const entity = buildCursorEntity(position.source, position.path);

  return {
    id: buildObservationFactID({
      source: position.source,
      entity,
      sourceUpdateTime: position.cursor,
    }),
    type: 'ingest.cursor.saved',
    v: 1,
    api: 'ingest/1',
    entity,
    at: new Date(position.nowMs).toISOString(),
    cursor: position.cursor,
    payload: {},
  };
}
