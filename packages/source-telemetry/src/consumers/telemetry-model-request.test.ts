import { expect, test } from 'bun:test';
import { applyFact } from './telemetry-model-request.ts';

test('it writes a Claude Code request with the counts written as text and no reported cost', () => {
  const fact = {
    id: 'event:telemetry:claude_code.api_request:req_07',
    type: 'telemetry.claude_code.api_request',
    v: 1,
    api: 'otlp-logs/1',
    entity: 'telemetry:session:s-4',
    at: '2026-11-11T05:00:00.000Z',
    payload: {
      resource: { attributes: [{ key: 'session.id', value: { stringValue: 'c-8' } }] },
      scope: { name: 'com.anthropic.claude_code.events' },
      logRecord: {
        attributes: [
          { key: 'model', value: { stringValue: 'model-large' } },
          { key: 'input_tokens', value: { stringValue: '7' } },
          { key: 'cache_read_tokens', value: { intValue: '120' } },
          { key: 'cache_creation_tokens', value: { intValue: 0 } },
          { key: 'output_tokens', value: { doubleValue: 64 } },
          { key: 'duration_ms', value: { stringValue: '2200' } },
        ],
      },
      origin: { issuer: 'harbour-host', subject: 'imp-0193' },
    },
  };

  const output: unknown = JSON.parse(applyFact(JSON.stringify(fact)));

  expect(output).toStrictEqual([
    {
      upsert: {
        telemetry_model_request: {
          id: 'telemetry:model_request:claude_code.api_request:req_07',
          session_id: 'telemetry:session:s-4',
          agent_session: 'c-8',
          product: 'claude_code',
          model: 'model-large',
          input_tokens: 7,
          cache_read_tokens: 120,
          cache_creation_tokens: 0,
          output_tokens: 64,
          cost_usd: null,
          cost_basis: 'none',
          duration_ms: 2200,
          agent: null,
          origin_issuer: 'harbour-host',
          origin_subject: 'imp-0193',
          at: '2026-11-11T05:00:00.000Z',
        },
      },
    },
  ]);
});

test('it reads a cost written as decimal text as the reported cost', () => {
  const fact = {
    id: 'event:telemetry:claude_code.api_request:req_08',
    type: 'telemetry.claude_code.api_request',
    v: 1,
    api: 'otlp-logs/1',
    entity: 'telemetry:session:s-4',
    at: '2026-11-11T05:00:00.000Z',
    payload: {
      resource: { attributes: [] },
      scope: { name: 'com.anthropic.claude_code.events' },
      logRecord: {
        attributes: [
          { key: 'model', value: { stringValue: 'model-large' } },
          { key: 'cost_usd', value: { stringValue: '0.0315' } },
          { key: 'input_tokens', value: { intValue: '1' } },
          { key: 'cache_read_tokens', value: { intValue: '2' } },
          { key: 'cache_creation_tokens', value: { intValue: '3' } },
          { key: 'output_tokens', value: { intValue: '4' } },
        ],
      },
      origin: { issuer: 'harbour-host', subject: 'imp-0193' },
    },
  };

  const output: unknown = JSON.parse(applyFact(JSON.stringify(fact)));

  expect(output).toStrictEqual([
    {
      upsert: {
        telemetry_model_request: {
          id: 'telemetry:model_request:claude_code.api_request:req_08',
          session_id: 'telemetry:session:s-4',
          agent_session: null,
          product: 'claude_code',
          model: 'model-large',
          input_tokens: 1,
          cache_read_tokens: 2,
          cache_creation_tokens: 3,
          output_tokens: 4,
          cost_usd: 0.0315,
          cost_basis: 'reported',
          duration_ms: null,
          agent: null,
          origin_issuer: 'harbour-host',
          origin_subject: 'imp-0193',
          at: '2026-11-11T05:00:00.000Z',
        },
      },
    },
  ]);
});

test('it never counts a cached token as input for Codex', () => {
  const fact = {
    id: 'event:telemetry:codex.sse_event:h-5e1a',
    type: 'telemetry.codex.sse_event',
    v: 1,
    api: 'otlp-logs/1',
    entity: 'telemetry:session:x-4',
    at: '2026-11-11T05:00:00.000Z',
    payload: {
      resource: { attributes: [] },
      scope: { name: 'codex_otel' },
      logRecord: {
        attributes: [
          { key: 'event.kind', value: { stringValue: 'response.completed' } },
          { key: 'conversation.id', value: { stringValue: 'x-4' } },
          { key: 'model', value: { stringValue: 'model-small' } },
          { key: 'input_token_count', value: { intValue: '300' } },
          { key: 'cached_token_count', value: { intValue: '500' } },
          { key: 'output_token_count', value: { intValue: '20' } },
          { key: 'duration_ms', value: { intValue: '900' } },
        ],
      },
      origin: { issuer: 'harbour-host', subject: 'imp-0193' },
    },
  };

  const output: unknown = JSON.parse(applyFact(JSON.stringify(fact)));

  expect(output).toStrictEqual([
    {
      upsert: {
        telemetry_model_request: {
          id: 'telemetry:model_request:codex.sse_event:h-5e1a',
          session_id: 'telemetry:session:x-4',
          agent_session: 'x-4',
          product: 'codex',
          model: 'model-small',
          input_tokens: 0,
          cache_read_tokens: 500,
          cache_creation_tokens: 0,
          output_tokens: 20,
          cost_usd: null,
          cost_basis: 'none',
          duration_ms: 900,
          agent: null,
          origin_issuer: 'harbour-host',
          origin_subject: 'imp-0193',
          at: '2026-11-11T05:00:00.000Z',
        },
      },
    },
  ]);
});

test.each([
  {
    row: 'a Claude Code error',
    type: 'telemetry.claude_code.api_error',
    attributes: [{ key: 'model', value: { stringValue: 'model-large' } }],
  },
  {
    row: 'a Claude Code request with no token counts',
    type: 'telemetry.claude_code.api_request',
    attributes: [{ key: 'model', value: { stringValue: 'model-large' } }],
  },
  {
    row: 'a Codex stream event that is not a completed response',
    type: 'telemetry.codex.sse_event',
    attributes: [
      { key: 'event.kind', value: { stringValue: 'response.output_text.delta' } },
      { key: 'model', value: { stringValue: 'model-small' } },
      { key: 'input_token_count', value: { intValue: '3' } },
      { key: 'output_token_count', value: { intValue: '4' } },
    ],
  },
  {
    row: 'a Codex completed response with no model',
    type: 'telemetry.codex.sse_event',
    attributes: [
      { key: 'event.kind', value: { stringValue: 'response.completed' } },
      { key: 'input_token_count', value: { intValue: '3' } },
      { key: 'output_token_count', value: { intValue: '4' } },
    ],
  },
  {
    row: 'an unlisted event',
    type: 'telemetry.codex.unlisted',
    attributes: [{ key: 'model', value: { stringValue: 'model-small' } }],
  },
])('it writes no row for $row', (row) => {
  const fact = {
    id: 'event:telemetry:codex.sse_event:h-77',
    type: row.type,
    v: 1,
    api: 'otlp-logs/1',
    entity: 'telemetry:session:x-4',
    at: '2026-11-11T05:00:00.000Z',
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

test('it writes no row for a fact with no origin', () => {
  const fact = {
    id: 'event:telemetry:claude_code.api_request:req_09',
    type: 'telemetry.claude_code.api_request',
    v: 1,
    api: 'otlp-logs/1',
    entity: 'telemetry:session:s-4',
    at: '2026-11-11T05:00:00.000Z',
    payload: {
      resource: { attributes: [] },
      scope: { name: 'com.anthropic.claude_code.events' },
      logRecord: {
        attributes: [
          { key: 'model', value: { stringValue: 'model-large' } },
          { key: 'input_tokens', value: { intValue: '1' } },
          { key: 'cache_read_tokens', value: { intValue: '2' } },
          { key: 'cache_creation_tokens', value: { intValue: '3' } },
          { key: 'output_tokens', value: { intValue: '4' } },
        ],
      },
    },
  };

  const output: unknown = JSON.parse(applyFact(JSON.stringify(fact)));

  expect(output).toStrictEqual([]);
});
