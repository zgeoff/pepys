import { expect, onTestFinished, test } from 'bun:test';
import type { EntityID } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import { toTagged } from '@zgeoff/std';
import { telemetryModelRequestConsumer } from '../telemetry-model-request-consumer.ts';
import { telemetryPlugin } from '../telemetry-plugin.ts';
import { sessionModelRequestsQuery } from './session-model-requests-query.ts';

interface RequestRowFields {
  id: string;
  session: string;
  issuer: string;
  at: string;
}

interface SessionInput {
  session: string;
  issuer: string;
  subject: string;
}

async function setupTest() {
  const store = await createTestStore({ plugins: [telemetryPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  return {
    writeRequests: (rows: readonly RequestRowFields[]) =>
      store.writeRows(
        telemetryModelRequestConsumer,
        'telemetry_model_request',
        rows.map((row) => ({
          id: toTagged<EntityID>(row.id),
          session_id: toTagged<EntityID>(row.session),
          agent_session: null,
          product: 'claude_code',
          model: 'model-large',
          input_tokens: 12,
          cache_read_tokens: 900,
          cache_creation_tokens: 30,
          output_tokens: 210,
          cost_usd: 0.4,
          cost_basis: 'reported',
          duration_ms: 4100,
          agent: null,
          origin_issuer: row.issuer,
          origin_subject: 'imp-0193',
          at: row.at,
        })),
      ),
    query: (input: SessionInput) => store.query(sessionModelRequestsQuery, input),
  };
}

test('it returns the model requests of a session from its sender, oldest first', async () => {
  const ctx = await setupTest();

  await ctx.writeRequests([
    {
      id: 'telemetry:model_request:claude_code.api_request:req_02',
      session: 'telemetry:session:s-9',
      issuer: 'harbour-host',
      at: '2026-11-11T02:25:00.000Z',
    },
    {
      id: 'telemetry:model_request:claude_code.api_request:req_01',
      session: 'telemetry:session:s-9',
      issuer: 'harbour-host',
      at: '2026-11-11T02:20:00.000Z',
    },
    {
      id: 'telemetry:model_request:claude_code.api_request:req_03',
      session: 'telemetry:session:s-4',
      issuer: 'harbour-host',
      at: '2026-11-11T02:21:00.000Z',
    },
  ]);

  const answer = await ctx.query({
    session: 'telemetry:session:s-9',
    issuer: 'harbour-host',
    subject: 'imp-0193',
  });

  expect(answer).toStrictEqual([
    {
      id: 'telemetry:model_request:claude_code.api_request:req_01',
      product: 'claude_code',
      model: 'model-large',
      input_tokens: 12,
      cache_read_tokens: 900,
      cache_creation_tokens: 30,
      output_tokens: 210,
      cost_usd: 0.4,
      at: '2026-11-11T02:20:00.000Z',
    },
    {
      id: 'telemetry:model_request:claude_code.api_request:req_02',
      product: 'claude_code',
      model: 'model-large',
      input_tokens: 12,
      cache_read_tokens: 900,
      cache_creation_tokens: 30,
      output_tokens: 210,
      cost_usd: 0.4,
      at: '2026-11-11T02:25:00.000Z',
    },
  ]);
});

test('it leaves out a row of the session that another sender stored', async () => {
  const ctx = await setupTest();

  await ctx.writeRequests([
    {
      id: 'telemetry:model_request:claude_code.api_request:req_01',
      session: 'telemetry:session:s-9',
      issuer: 'other-host',
      at: '2026-11-11T02:20:00.000Z',
    },
  ]);

  const answer = await ctx.query({
    session: 'telemetry:session:s-9',
    issuer: 'harbour-host',
    subject: 'imp-0193',
  });

  expect(answer).toStrictEqual([]);
});
