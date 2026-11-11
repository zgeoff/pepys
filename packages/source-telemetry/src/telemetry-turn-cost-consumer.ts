import { defineConsumer, defineTable } from '@pepys/kit';
import { logRecordFamily } from './log-record-family.ts';

// The cost a product reports per turn: a second consumer on the same stream.
export const telemetryTurnCostConsumer = defineConsumer({
  name: 'telemetry_turn_cost',
  entry: new URL('consumers/telemetry-turn-cost.ts', import.meta.url),
  input: { mode: 'fact', streams: [logRecordFamily.stream] },
  tables: {
    telemetry_turn_cost: defineTable({
      columns: {
        // `telemetry:turn_cost:<product>.<event>:<key>`
        id: { kind: 'entityID' },
        session_id: { kind: 'entityID' },
        agent_session: { kind: 'text', nullable: true },
        product: { kind: 'text' },

        // the model the record names, so a report can group turn costs by model; null when absent
        model: { kind: 'text', nullable: true },
        cost_usd: { kind: 'real' },
        origin_issuer: { kind: 'text' },
        origin_subject: { kind: 'text' },
        at: { kind: 'timestamp' },
      },
      primaryKey: ['id'],
      indexes: [{ columns: ['session_id'] }],
    }),
  },
  entityViews: [
    {
      table: 'telemetry_turn_cost',
      kind: 'telemetry:turn_cost',
      id: 'id',
      title: 'product',
      url: null,
      actor: null,
      updatedAt: 'at',
    },
  ],
  reads: [],
  links: [],
});
