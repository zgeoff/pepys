import { expect, onTestFinished, test } from 'bun:test';
import type { EntityID } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import { toTagged } from '@zgeoff/std';
import { readOtlpFacts } from '../otlp/read-otlp-facts.ts';
import type { LogsExport } from '../otlp/types.ts';
import { products } from '../products/products.ts';
import { telemetryPlugin, telemetrySource } from '../telemetry-plugin.ts';
import { buildLogsExport } from '../test-utils/build-logs-export.ts';
import { sessionModelRequestsQuery } from './session-model-requests-query.ts';

interface SessionInput {
  session: string;
  issuer: string;
  subject: string;
}

async function setupTest() {
  const store = await createTestStore({ plugins: [telemetryPlugin] });

  onTestFinished(() => store[Symbol.asyncDispose]());

  return {
    store,
    readFacts: (exports: readonly LogsExport[]) =>
      exports.flatMap(
        (body) => readOtlpFacts(body, { products, sessionAttribute: 'atc.session.id' }).facts,
      ),
    query: (input: SessionInput) => store.query(sessionModelRequestsQuery, input),
  };
}

test('it returns the model requests of a session from its sender, oldest first', async () => {
  const ctx = await setupTest();

  const facts = ctx.readFacts([
    buildLogsExport('claude_code', { 'atc.session.id': 's-9' }, [
      {
        'event.name': 'api_request',
        'session.id': 'c-1',
        'event.timestamp': '2026-11-11T02:25:00.000Z',
        request_id: 'req_01',
        model: 'model-large',
        cost_usd: 0.4,
        input_tokens: 12,
        cache_read_tokens: 900,
        cache_creation_tokens: 30,
        output_tokens: 210,
      },
      {
        'event.name': 'api_request',
        'session.id': 'c-1',
        'event.timestamp': '2026-11-11T02:20:00.000Z',
        request_id: 'req_02',
        model: 'model-large',
        cost_usd: 0.25,
        input_tokens: 8,
        cache_read_tokens: 600,
        cache_creation_tokens: 0,
        output_tokens: 95,
      },
    ]),
    buildLogsExport('claude_code', { 'atc.session.id': 's-4' }, [
      {
        'event.name': 'api_request',
        'session.id': 'c-2',
        'event.timestamp': '2026-11-11T02:21:00.000Z',
        request_id: 'req_03',
        model: 'model-large',
        cost_usd: 0.1,
        input_tokens: 4,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        output_tokens: 20,
      },
    ]),
  ]);

  await ctx.store.apply(telemetrySource, facts, {
    sender: { issuer: 'harbour-host', subject: 'imp-0193' },
  });

  const answer = await ctx.query({
    session: 'telemetry:session:s-9',
    issuer: 'harbour-host',
    subject: 'imp-0193',
  });

  expect(answer).toStrictEqual([
    {
      id: toTagged<EntityID>('telemetry:model_request:claude_code.api_request:req_02'),
      product: 'claude_code',
      model: 'model-large',
      input_tokens: 8,
      cache_read_tokens: 600,
      cache_creation_tokens: 0,
      output_tokens: 95,
      cost_usd: 0.25,
      at: '2026-11-11T02:20:00.000Z',
    },
    {
      id: toTagged<EntityID>('telemetry:model_request:claude_code.api_request:req_01'),
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

  const facts = ctx.readFacts([
    buildLogsExport('claude_code', { 'atc.session.id': 's-9' }, [
      {
        'event.name': 'api_request',
        'session.id': 'c-1',
        'event.timestamp': '2026-11-11T02:20:00.000Z',
        request_id: 'req_01',
        model: 'model-large',
        cost_usd: 0.4,
        input_tokens: 12,
        cache_read_tokens: 900,
        cache_creation_tokens: 30,
        output_tokens: 210,
      },
    ]),
  ]);

  await ctx.store.apply(telemetrySource, facts, {
    sender: { issuer: 'other-host', subject: 'imp-0193' },
  });

  const answer = await ctx.query({
    session: 'telemetry:session:s-9',
    issuer: 'harbour-host',
    subject: 'imp-0193',
  });

  expect(answer).toStrictEqual([]);
});

test('it answers no rows for a session that is no entity ID', async () => {
  const ctx = await setupTest();

  const facts = ctx.readFacts([
    buildLogsExport('claude_code', { 'atc.session.id': 's-9' }, [
      {
        'event.name': 'api_request',
        'session.id': 'c-1',
        'event.timestamp': '2026-11-11T02:20:00.000Z',
        request_id: 'req_01',
        model: 'model-large',
        cost_usd: 0.4,
        input_tokens: 12,
        cache_read_tokens: 900,
        cache_creation_tokens: 30,
        output_tokens: 210,
      },
    ]),
  ]);

  await ctx.store.apply(telemetrySource, facts, {
    sender: { issuer: 'harbour-host', subject: 'imp-0193' },
  });

  const answer = await ctx.query({ session: 's-9', issuer: 'harbour-host', subject: 'imp-0193' });

  expect(answer).toStrictEqual([]);
});

test('it leaves out a row of the session that the same issuer stored for another subject', async () => {
  const ctx = await setupTest();

  const facts = ctx.readFacts([
    buildLogsExport('claude_code', { 'atc.session.id': 's-9' }, [
      {
        'event.name': 'api_request',
        'session.id': 'c-1',
        'event.timestamp': '2026-11-11T02:20:00.000Z',
        request_id: 'req_01',
        model: 'model-large',
        cost_usd: 0.4,
        input_tokens: 12,
        cache_read_tokens: 900,
        cache_creation_tokens: 30,
        output_tokens: 210,
      },
    ]),
  ]);

  await ctx.store.apply(telemetrySource, facts, {
    sender: { issuer: 'harbour-host', subject: 'imp-0388' },
  });

  const answer = await ctx.query({
    session: 'telemetry:session:s-9',
    issuer: 'harbour-host',
    subject: 'imp-0193',
  });

  expect(answer).toStrictEqual([]);
});

test('it orders two requests of one time by ID', async () => {
  const ctx = await setupTest();

  const facts = ctx.readFacts([
    buildLogsExport('claude_code', { 'atc.session.id': 's-9' }, [
      {
        'event.name': 'api_request',
        'session.id': 'c-1',
        'event.timestamp': '2026-11-11T02:20:00.000Z',
        request_id: 'req_b',
        model: 'model-large',
        cost_usd: 0.4,
        input_tokens: 12,
        cache_read_tokens: 900,
        cache_creation_tokens: 30,
        output_tokens: 210,
      },
      {
        'event.name': 'api_request',
        'session.id': 'c-1',
        'event.timestamp': '2026-11-11T02:20:00.000Z',
        request_id: 'req_a',
        model: 'model-small',
        cost_usd: 0.05,
        input_tokens: 3,
        cache_read_tokens: 40,
        cache_creation_tokens: 0,
        output_tokens: 18,
      },
    ]),
  ]);

  await ctx.store.apply(telemetrySource, facts, {
    sender: { issuer: 'harbour-host', subject: 'imp-0193' },
  });

  const answer = await ctx.query({
    session: 'telemetry:session:s-9',
    issuer: 'harbour-host',
    subject: 'imp-0193',
  });

  expect(answer).toStrictEqual([
    {
      id: toTagged<EntityID>('telemetry:model_request:claude_code.api_request:req_a'),
      product: 'claude_code',
      model: 'model-small',
      input_tokens: 3,
      cache_read_tokens: 40,
      cache_creation_tokens: 0,
      output_tokens: 18,
      cost_usd: 0.05,
      at: '2026-11-11T02:20:00.000Z',
    },
    {
      id: toTagged<EntityID>('telemetry:model_request:claude_code.api_request:req_b'),
      product: 'claude_code',
      model: 'model-large',
      input_tokens: 12,
      cache_read_tokens: 900,
      cache_creation_tokens: 30,
      output_tokens: 210,
      cost_usd: 0.4,
      at: '2026-11-11T02:20:00.000Z',
    },
  ]);
});
