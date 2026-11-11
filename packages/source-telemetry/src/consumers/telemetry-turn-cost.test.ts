import { expect, test } from 'bun:test';
import { applyFact } from './telemetry-turn-cost.ts';

test("it writes Codex's estimate for a turn, with the model the record names", () => {
  const fact = {
    id: 'event:telemetry:codex.turn_cost:turn-2',
    type: 'telemetry.codex.turn_cost',
    v: 1,
    api: 'otlp-logs/1',
    entity: 'telemetry:session:s-9',
    at: '2026-11-11T05:10:00.000Z',
    payload: {
      resource: { attributes: [] },
      scope: { name: 'codex_otel' },
      logRecord: {
        attributes: [
          { key: 'conversation.id', value: { stringValue: 'x-4' } },
          { key: 'usage.estimated_usd', value: { stringValue: '0.25' } },
          { key: 'model', value: { stringValue: 'model-small' } },
        ],
      },
      origin: { issuer: 'harbour-host', subject: 'imp-0193' },
    },
  };

  const output: unknown = JSON.parse(applyFact(JSON.stringify(fact)));

  expect(output).toStrictEqual([
    {
      upsert: {
        telemetry_turn_cost: {
          id: 'telemetry:turn_cost:codex.turn_cost:turn-2',
          session_id: 'telemetry:session:s-9',
          agent_session: 'x-4',
          product: 'codex',
          model: 'model-small',
          cost_usd: 0.25,
          origin_issuer: 'harbour-host',
          origin_subject: 'imp-0193',
          at: '2026-11-11T05:10:00.000Z',
        },
      },
    },
  ]);
});

test('it writes a null model for a turn whose record names none', () => {
  const fact = {
    id: 'event:telemetry:codex.turn_cost:turn-3',
    type: 'telemetry.codex.turn_cost',
    v: 1,
    api: 'otlp-logs/1',
    entity: 'telemetry:session:s-9',
    at: '2026-11-11T05:10:00.000Z',
    payload: {
      resource: { attributes: [] },
      scope: { name: 'codex_otel' },
      logRecord: {
        attributes: [
          { key: 'usage.estimated_usd', value: { doubleValue: 0.5 } },
          { key: 'model', value: { stringValue: '' } },
        ],
      },
      origin: { issuer: 'harbour-host', subject: 'imp-0193' },
    },
  };

  const output: unknown = JSON.parse(applyFact(JSON.stringify(fact)));

  expect(output).toStrictEqual([
    {
      upsert: {
        telemetry_turn_cost: {
          id: 'telemetry:turn_cost:codex.turn_cost:turn-3',
          session_id: 'telemetry:session:s-9',
          agent_session: null,
          product: 'codex',
          model: null,
          cost_usd: 0.5,
          origin_issuer: 'harbour-host',
          origin_subject: 'imp-0193',
          at: '2026-11-11T05:10:00.000Z',
        },
      },
    },
  ]);
});

test.each([
  {
    row: 'a Codex turn with no estimate',
    type: 'telemetry.codex.turn_cost',
    attributes: [{ key: 'usage.estimated_usd', value: { stringValue: 'n/a' } }],
  },
  {
    row: 'a Claude Code request, whose cost is per request',
    type: 'telemetry.claude_code.api_request',
    attributes: [{ key: 'cost_usd', value: { doubleValue: 0.4 } }],
  },
])('it writes no row for $row', (row) => {
  const fact = {
    id: 'event:telemetry:codex.turn_cost:turn-4',
    type: row.type,
    v: 1,
    api: 'otlp-logs/1',
    entity: 'telemetry:session:s-9',
    at: '2026-11-11T05:10:00.000Z',
    payload: {
      resource: { attributes: [] },
      scope: { name: 'codex_otel' },
      logRecord: { attributes: row.attributes },
      origin: { issuer: 'harbour-host', subject: 'imp-0193' },
    },
  };

  const output: unknown = JSON.parse(applyFact(JSON.stringify(fact)));

  expect(output).toStrictEqual([]);
});
