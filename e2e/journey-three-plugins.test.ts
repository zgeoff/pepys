import { expect, test } from 'bun:test';
import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { DeploymentClient } from '@pepys/api';
import type { EntityID } from '@pepys/kit';
import { S2 } from '@s2-dev/streamstore';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { buildLogsExport } from '../packages/source-telemetry/src/test-utils/build-logs-export.ts';
import type { e2eDeployment } from './deployment/e2e-deployment.ts';

// The preload sends every fact these tests read: GitHub webhooks, a signed logbook fact batch, and
// one OTLP logs export with a proven sender. Each test only reads, but the refusal test sends.
function setupTest() {
  const s2Endpoint = process.env['PEPYS_S2_ENDPOINT'];
  const s2AccessToken = process.env['PEPYS_S2_ACCESS_TOKEN'];
  const s2Basin = process.env['PEPYS_S2_BASIN'];
  const apiURL = process.env['PEPYS_E2E_API_URL'];
  const ingestURL = process.env['PEPYS_E2E_INGEST_URL'];

  invariant(
    s2Endpoint !== undefined &&
      s2AccessToken !== undefined &&
      s2Basin !== undefined &&
      apiURL !== undefined &&
      ingestURL !== undefined,
    'run the e2e lane with bun run test:e2e, which preloads e2e/start-stack.ts',
  );

  const s2 = new S2({
    accessToken: s2AccessToken,
    endpoints: { account: s2Endpoint, basin: s2Endpoint },
  });

  const api: DeploymentClient<typeof e2eDeployment> = createORPCClient(
    new RPCLink({ url: '/rpc', origin: new URL(apiURL).origin }),
  );

  return {
    api,
    writeLogs: (headers: Record<string, string>, body: unknown) =>
      fetch(new URL('/v1/logs', ingestURL), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body),
      }),
    readTelemetryTail: () => s2.basin(s2Basin).stream('facts.telemetry.log_record').checkTail(),
  };
}

test("it serves the voyages of the outside plug-in's signed fact batch through its query", async () => {
  const ctx = setupTest();

  const answer = await ctx.api.logbook_harbour_voyages({ harbour: 'Port Coral' });

  expect(answer).toStrictEqual([
    {
      id: 'logbook:voyage:v-1',
      title: 'Charting the harbour reef',
      logged_at: '2026-10-02T07:00:00Z',
    },
    {
      id: 'logbook:voyage:v-2',
      title: 'Sounding the north channel',
      logged_at: '2026-10-03T07:00:00Z',
    },
  ]);
});

test('it serves a voyage of the outside plug-in through get_entity', async () => {
  const ctx = setupTest();

  const answer = await ctx.api.get_entity({ id: 'logbook:voyage:v-1' });

  expect(answer).toStrictEqual({
    entity: {
      id: toTagged<EntityID>('logbook:voyage:v-1'),
      kind: 'logbook:voyage',
      title: 'Charting the harbour reef',
      url: null,
      actor: null,
      updated_at: '2026-10-02T07:00:00Z',
    },
    consumer: 'logbook_voyage',
    table: 'logbook_voyage',
    row: {
      id: 'logbook:voyage:v-1',
      title: 'Charting the harbour reef',
      harbour: 'Port Coral',
      logged_at: '2026-10-02T07:00:00Z',
    },
  });
});

test('it walks from a voyage across its link to the GitHub pull request it cites', async () => {
  const ctx = setupTest();

  const answer = await ctx.api.neighbourhood({ id: 'logbook:voyage:v-1' });

  expect(answer).toStrictEqual({
    entities: [
      {
        id: toTagged<EntityID>('logbook:voyage:v-1'),
        kind: 'logbook:voyage',
        title: 'Charting the harbour reef',
        url: null,
        actor: null,
        updated_at: '2026-10-02T07:00:00Z',
        depth: 0,
      },
      {
        id: toTagged<EntityID>('github:pull_request:1874433021'),
        kind: 'github:pull_request',
        title: 'Add the harbour map and tides',
        url: 'https://github.example/acme/harbour/pull/12',
        actor: toTagged<EntityID>('github:user:4401'),
        updated_at: '2026-10-01T10:00:00Z',
        depth: 1,
      },
    ],
    links: [
      {
        type: 'logbook_voyage_cites',
        from: toTagged<EntityID>('logbook:voyage:v-1'),
        to: toTagged<EntityID>('github:pull_request:1874433021'),
        direction: 'outgoing',
        origin: 'logbook_voyage',
        confidence: 1,
        depth: 1,
      },
    ],
    unresolved: [],
    skippedConsumers: [],
    isTruncated: false,
  });
});

test("it serves the GitHub plug-in's delivery query for the stored pull request", async () => {
  const ctx = setupTest();

  const answer = await ctx.api.github_pull_request_delivery({
    pullRequests: ['github:pull_request:1874433021'],
    environment: 'production',
  });

  expect(answer).toStrictEqual([
    {
      pullRequest: toTagged<EntityID>('github:pull_request:1874433021'),
      mergedAt: null,
      release: null,
      deploy: null,
    },
  ]);
});

test('it serves the model request of an OTLP export with a proven sender through the telemetry query', async () => {
  const ctx = setupTest();

  const answer = await ctx.api.telemetry_session_model_requests({
    session: 'telemetry:session:s-harbour',
    issuer: 'harbour-broker',
    subject: 'imp-7731',
  });

  expect(answer).toStrictEqual([
    {
      id: toTagged<EntityID>('telemetry:model_request:claude_code.api_request:req_harbour_01'),
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

test('it refuses with 401 an OTLP export with the bearer secret and no proven sender, and stores nothing', async () => {
  const ctx = setupTest();

  const response = await ctx.writeLogs(
    { authorization: 'Bearer telemetry-e2e-token' },
    buildLogsExport('claude_code', { 'atc.session.id': 's-harbour' }, [
      {
        'event.name': 'api_request',
        'event.timestamp': '2026-11-11T02:30:00.000Z',
        request_id: 'req_harbour_02',
        model: 'model-large',
        input_tokens: 40,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        output_tokens: 15,
      },
    ]),
  );

  expect(response.status).toBe(401);

  // the preload stored one record, from the export with a proven sender
  const tail = await ctx.readTelemetryTail();

  expect(tail.tail.seqNum).toBe(1);
});
