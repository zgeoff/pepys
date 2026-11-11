import {
  initTelemetryTurnCostModel,
  parseTelemetrySessionID,
  parseTelemetryTurnCostFact,
  toTelemetryTurnCostID,
  updateTelemetryTurnCostModel,
} from '../generated/telemetry-turn-cost-boundary.ts';
import type {
  TelemetryTurnCostMessage,
  TelemetryTurnCostModel,
  TelemetryTurnCostOperation,
} from '../generated/telemetry-turn-cost-boundary.ts';
import { findCodexTurnCost } from './products/find-codex-turn-cost.ts';
import { parseFactType } from './products/parse-fact-type.ts';
import type { ProductName, StoredRecord, TurnCostFields } from './products/types.ts';

export type {
  TelemetryTurnCostMessage,
  TelemetryTurnCostModel,
} from '../generated/telemetry-turn-cost-boundary.ts';

// scriptc takes the model and message types through a re-export, but not the two functions
export function init(): TelemetryTurnCostModel {
  return initTelemetryTurnCostModel();
}

export function update(
  model: TelemetryTurnCostModel,
  message: TelemetryTurnCostMessage,
): TelemetryTurnCostModel {
  return updateTelemetryTurnCostModel(model, message);
}

type TurnCostReader = (event: string, record: StoredRecord) => TurnCostFields | undefined;

// One reader per product: a product with no entry here fails the type check. Claude Code reports
// its cost per request, so it has no turn cost, and a sum over both tables counts nothing twice.
const readers: Readonly<Record<ProductName, TurnCostReader>> = {
  claude_code: findNoTurnCost,
  codex: findCodexTurnCost,
};

const factIDPrefix = 'event:telemetry:';

export function applyFact(factJSON: string): string {
  return JSON.stringify(mapFact(factJSON));
}

function mapFact(factJSON: string): TelemetryTurnCostOperation[] {
  const fact = parseTelemetryTurnCostFact(factJSON);
  const type = fact === undefined ? undefined : parseFactType(fact.type);

  if (fact === undefined || type === undefined || !fact.id.startsWith(factIDPrefix)) {
    return [];
  }

  const session = parseTelemetrySessionID(fact.entity);
  const fields = readers[type.product](type.event, fact.payload);

  if (session === undefined || fields === undefined) {
    return [];
  }

  return [
    {
      upsert: {
        telemetry_turn_cost: {
          id: toTelemetryTurnCostID(fact.id.slice(factIDPrefix.length)),
          session_id: session,
          agent_session: fields.agent_session,
          product: type.product,
          model: fields.model,
          cost_usd: fields.cost_usd,
          origin_issuer: fact.payload.origin.issuer,
          origin_subject: fact.payload.origin.subject,
          at: fact.at,
        },
      },
    },
  ];
}

function findNoTurnCost(): TurnCostFields | undefined {
  return undefined;
}
