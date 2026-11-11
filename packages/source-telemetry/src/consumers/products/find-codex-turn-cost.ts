import { findRecordNumber, findRecordText } from './find-record-number.ts';
import type { StoredRecord, TurnCostFields } from './types.ts';

// One `turn_cost` record is Codex's own estimate for one turn. A record with no number makes no row.
export function findCodexTurnCost(event: string, record: StoredRecord): TurnCostFields | undefined {
  if (event !== 'turn_cost') {
    return undefined;
  }

  const cost = findRecordNumber(record, 'usage.estimated_usd');

  if (cost === undefined) {
    return undefined;
  }

  return {
    agent_session: findRecordText(record, 'conversation.id') ?? null,
    model: findRecordText(record, 'model') ?? null,
    cost_usd: cost,
  };
}
