import {
  initTelemetryModelRequestModel,
  parseTelemetryModelRequestFact,
  parseTelemetrySessionID,
  toTelemetryModelRequestID,
  updateTelemetryModelRequestModel,
} from '../generated/telemetry-model-request-boundary.ts';
import type {
  TelemetryModelRequestMessage,
  TelemetryModelRequestModel,
  TelemetryModelRequestOperation,
} from '../generated/telemetry-model-request-boundary.ts';
import { findClaudeCodeModelRequest } from './products/find-claude-code-model-request.ts';
import { findCodexModelRequest } from './products/find-codex-model-request.ts';
import { parseFactType } from './products/parse-fact-type.ts';
import type { ModelRequestFields, ProductName, StoredRecord } from './products/types.ts';

export type {
  TelemetryModelRequestMessage,
  TelemetryModelRequestModel,
} from '../generated/telemetry-model-request-boundary.ts';

// scriptc takes the model and message types through a re-export, but not the two functions
export function init(): TelemetryModelRequestModel {
  return initTelemetryModelRequestModel();
}

export function update(
  model: TelemetryModelRequestModel,
  message: TelemetryModelRequestMessage,
): TelemetryModelRequestModel {
  return updateTelemetryModelRequestModel(model, message);
}

type ModelRequestReader = (event: string, record: StoredRecord) => ModelRequestFields | undefined;

// One reader per product: a product with no entry here fails the type check.
const readers: Readonly<Record<ProductName, ModelRequestReader>> = {
  claude_code: findClaudeCodeModelRequest,
  codex: findCodexModelRequest,
};

const factIDPrefix = 'event:telemetry:';

export function applyFact(factJSON: string): string {
  return JSON.stringify(mapFact(factJSON));
}

// The host calls it once per fact ID, so a copy never gets here, and the row's key comes from the
// fact's ID, so the order of the facts changes nothing.
function mapFact(factJSON: string): TelemetryModelRequestOperation[] {
  const fact = parseTelemetryModelRequestFact(factJSON);
  const type = fact === undefined ? undefined : parseFactType(fact.type);

  if (fact === undefined || type === undefined || !fact.id.startsWith(factIDPrefix)) {
    return [];
  }

  // ingest chose the session, so the row copies the fact's entity and reads no attribute for it
  const session = parseTelemetrySessionID(fact.entity);
  const fields = readers[type.product](type.event, fact.payload);

  if (session === undefined || fields === undefined) {
    return [];
  }

  return [
    {
      upsert: {
        telemetry_model_request: {
          id: toTelemetryModelRequestID(fact.id.slice(factIDPrefix.length)),
          session_id: session,
          agent_session: fields.agent_session,
          product: type.product,
          model: fields.model,
          input_tokens: fields.input_tokens,
          cache_read_tokens: fields.cache_read_tokens,
          cache_creation_tokens: fields.cache_creation_tokens,
          output_tokens: fields.output_tokens,
          cost_usd: fields.reported_cost_usd,
          cost_basis: fields.reported_cost_usd === null ? 'none' : 'reported',
          duration_ms: fields.duration_ms,
          agent: fields.agent,
          origin_issuer: fact.payload.origin.issuer,
          origin_subject: fact.payload.origin.subject,
          at: fact.at,
        },
      },
    },
  ];
}
