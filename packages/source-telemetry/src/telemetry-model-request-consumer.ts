import { defineConsumer, defineTable } from '@pepys/kit';
import { logRecordFamily } from './log-record-family.ts';

// Fact mode: one row comes from exactly one fact, and the row's key comes from the fact's ID, so
// the order of the facts changes nothing.
export const telemetryModelRequestConsumer = defineConsumer({
  name: 'telemetry_model_request',
  entry: new URL('consumers/telemetry-model-request.ts', import.meta.url),
  input: { mode: 'fact', streams: [logRecordFamily.stream] },
  tables: {
    telemetry_model_request: defineTable({
      columns: {
        // `telemetry:model_request:<product>.<event>:<key>`
        id: { kind: 'entityID' },

        // The join key: `telemetry:session:<atc session ID>`, or the agent's own session ID when
        // the record has no atc session ID.
        session_id: { kind: 'entityID' },

        // The agent's own session ID. It changes inside one atc session, so nothing joins on it.
        agent_session: { kind: 'text', nullable: true },
        product: { kind: 'text' },
        model: { kind: 'text' },

        // never holds a token that the cache read or wrote, for every product
        input_tokens: { kind: 'integer' },
        cache_read_tokens: { kind: 'integer' },
        cache_creation_tokens: { kind: 'integer' },
        output_tokens: { kind: 'integer' },

        // null when the product reports no cost for one request; 0 never stands for unknown
        cost_usd: { kind: 'real', nullable: true },
        cost_basis: { kind: 'text' },
        duration_ms: { kind: 'integer', nullable: true },
        agent: { kind: 'text', nullable: true },

        // the proven sender of the export that carried the record
        origin_issuer: { kind: 'text' },
        origin_subject: { kind: 'text' },
        at: { kind: 'timestamp' },
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['session_id'] }, { columns: ['at'] }],
    }),
  },
  entityViews: [
    {
      table: 'telemetry_model_request',
      kind: 'telemetry:model_request',
      id: 'id',
      title: 'model',
      url: null,
      actor: null,
      updatedAt: 'at',
    },
  ],
  reads: [],
  links: [],
});
