import { expect, expectTypeOf, test } from 'bun:test';
import { join } from 'node:path';
import { checkBuildTarget, collectGlueFiles } from '@pepys/cli';
import { checkDeployment } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import invariant from 'tiny-invariant';
import type { ProductName as ConsumerProductName } from './consumers/products/types.ts';
import { readOtlpFacts } from './otlp/read-otlp-facts.ts';
import type { LogsExport } from './otlp/types.ts';
import { products } from './products/products.ts';
import type { ProductName } from './products/products.ts';
import { telemetryPlugin, telemetrySource } from './telemetry-plugin.ts';
import { buildLogsExport } from './test-utils/build-logs-export.ts';

function setupTest() {
  const sender = { issuer: 'harbour-host', subject: 'imp-0193' };

  return {
    sender,
    readFacts: (exports: readonly LogsExport[]) =>
      exports.flatMap(
        (body) => readOtlpFacts(body, { products, sessionAttribute: 'atc.session.id' }).facts,
      ),
    createStore: () => createTestStore({ plugins: [telemetryPlugin] }),
  };
}

test('it gives the same rows for an export sent twice and for its records in any order', async () => {
  const ctx = setupTest();

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
        duration_ms: 4100,
      },
    ]),
    buildLogsExport('codex', {}, [
      {
        'event.name': 'codex.turn_cost',
        'conversation.id': 'x-4',
        'event.timestamp': '2026-11-11T02:21:30.000Z',
        'turn.id': 'turn-2',
        'usage.estimated_usd': 0.12,
        model: 'model-small',
      },
      {
        'event.name': 'codex.sse_event',
        'event.kind': 'response.completed',
        'conversation.id': 'x-4',
        'event.timestamp': '2026-11-11T02:21:00.000Z',
        model: 'model-small',
        input_token_count: '1000',
        cached_token_count: 800,
        output_token_count: '50',
      },
    ]),
  ]);

  await using once = await ctx.createStore();
  await using twice = await ctx.createStore();

  await once.apply(telemetrySource, facts, { sender: ctx.sender });
  await twice.apply(telemetrySource, [...facts.toReversed(), ...facts], { sender: ctx.sender });

  const rows = {
    modelRequests: await once.readRows('telemetry_model_request'),
    turnCosts: await once.readRows('telemetry_turn_cost'),
  };

  expect({
    modelRequests: await twice.readRows('telemetry_model_request'),
    turnCosts: await twice.readRows('telemetry_turn_cost'),
  }).toStrictEqual(rows);
});

test('it keeps one row per model request and per turn cost, with the session and the origin', async () => {
  const ctx = setupTest();

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
        duration_ms: 4100,
      },
      {
        'event.name': 'api_error',
        'session.id': 'c-1',
        'event.timestamp': '2026-11-11T02:20:09.000Z',
        request_id: 'req_01',
        model: 'model-large',
      },
    ]),
    buildLogsExport('codex', {}, [
      {
        'event.name': 'codex.sse_event',
        'event.kind': 'response.completed',
        'conversation.id': 'x-4',
        'event.timestamp': '2026-11-11T02:21:00.000Z',
        model: 'model-small',
        input_token_count: '1000',
        cached_token_count: 800,
        output_token_count: '50',
      },
      {
        'event.name': 'codex.turn_cost',
        'conversation.id': 'x-4',
        'event.timestamp': '2026-11-11T02:21:30.000Z',
        'turn.id': 'turn-2',
        'usage.estimated_usd': 0.12,
        model: 'model-small',
      },
    ]),
  ]);

  await using store = await ctx.createStore();

  await store.apply(telemetrySource, facts, { sender: ctx.sender });

  expect({
    modelRequests: await store.readRows('telemetry_model_request'),
    turnCosts: await store.readRows('telemetry_turn_cost'),
  }).toStrictEqual({
    modelRequests: [
      {
        id: 'telemetry:model_request:claude_code.api_request:req_01',
        session_id: 'telemetry:session:s-9',
        agent_session: 'c-1',
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
        origin_issuer: 'harbour-host',
        origin_subject: 'imp-0193',
        at: '2026-11-11T02:20:00.000Z',
      },
      {
        id: expect.stringMatching(/^telemetry:model_request:codex\.sse_event:h-[0-9a-f]{64}$/u),
        session_id: 'telemetry:session:x-4',
        agent_session: 'x-4',
        product: 'codex',
        model: 'model-small',
        input_tokens: 200,
        cache_read_tokens: 800,
        cache_creation_tokens: 0,
        output_tokens: 50,
        cost_usd: null,
        cost_basis: 'none',
        duration_ms: null,
        agent: null,
        origin_issuer: 'harbour-host',
        origin_subject: 'imp-0193',
        at: '2026-11-11T02:21:00.000Z',
      },
    ],
    turnCosts: [
      {
        id: 'telemetry:turn_cost:codex.turn_cost:turn-2',
        session_id: 'telemetry:session:x-4',
        agent_session: 'x-4',
        product: 'codex',
        model: 'model-small',
        cost_usd: 0.12,
        origin_issuer: 'harbour-host',
        origin_subject: 'imp-0193',
        at: '2026-11-11T02:21:30.000Z',
      },
    ],
  });
});

test('it declares a plug-in that passes the deployment check', () => {
  const checked = checkDeployment({ name: 'harbour', plugins: [telemetryPlugin] });

  expect(checked.ok).toBeTrue();
});

test('it asks ingest for the token check and the imp identity of the sender', () => {
  const path = telemetrySource.live;

  invariant(path?.kind === 'receive', 'the telemetry source receives');

  expect({ check: path.check, sender: path.sender }).toStrictEqual({
    check: { kind: 'token', header: 'authorization', secretEnv: 'PEPYS_TELEMETRY_TOKEN' },
    sender: {
      kind: 'imp-identity',
      audience: 'pepys.imp.example',
      issuersEnv: 'PEPYS_IMP_IDENTITY_ISSUERS',
    },
  });
});

test('it names the same products in the consumers as in the source', () => {
  expectTypeOf<ConsumerProductName>().toEqualTypeOf<ProductName>();
});

test('it commits the glue that the declarations generate', async () => {
  const target = checkBuildTarget({ kind: 'plugin', plugin: telemetryPlugin });

  invariant(target.ok, 'the plug-in passes its check');

  const glue = collectGlueFiles({ target: target.value, packageRoot: join(import.meta.dir, '..') });

  const committed = await Promise.all(
    glue.map(async (file) => ({ path: file.path, content: await Bun.file(file.path).text() })),
  );

  expect(committed).toStrictEqual(glue);
});
