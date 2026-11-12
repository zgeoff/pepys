import { expect, test } from 'bun:test';
import { gzipSync } from 'node:zlib';
import { createFakeSenderProof, createIngest, createMemoryFactLog } from '@pepys/ingest';
import { checkDeployment, createLogger } from '@pepys/kit';
import type { SenderProof, StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { telemetryPlugin } from '../telemetry-plugin.ts';
import { buildLogsExport } from '../test-utils/build-logs-export.ts';

function setupTest() {
  const checked = checkDeployment({ name: 'harbour', plugins: [telemetryPlugin] });

  invariant(checked.ok, 'the telemetry deployment passes its check');

  const stream = toTagged<StreamName>('facts.telemetry.log_record');
  const log = createMemoryFactLog([stream]);
  const lines: string[] = [];
  const logger = createLogger({ write: (line) => lines.push(line) });

  const createIngestWith = (senderProof: SenderProof) =>
    createIngest({
      deployment: checked.value,
      secrets: { PEPYS_TELEMETRY_TOKEN: 'tide-key' },
      log,
      senderProof,
      appendRetry: { maxAttempts: 1, retryDelayMs: 0 },
      now: () => 0,
      logger,
    });

  return {
    readLogged: () => lines.map((line): unknown => JSON.parse(line)),
    createIngestWith,
    ingest: createIngestWith(
      createFakeSenderProof({
        'token-4': { issuer: 'harbour-host', subject: 'imp-0193', name: 'tidy-otter' },
      }),
    ),
    readStored: async () => {
      const read = await log.read(stream, toTagged<StreamOffset>(0), 100);

      invariant(read.ok, 'the stream exists');

      return read.value.map((item) => item.fact);
    },
    readAnswer: async (response: Response) => {
      const body: unknown = await response.json();

      return { status: response.status, body };
    },
  };
}

test('it answers 200 with {} to a gzip export, and stores each record whole with the proven origin', async () => {
  const ctx = setupTest();

  const exported = buildLogsExport('codex', { 'atc.session.id': 's-9' }, [
    {
      'event.name': 'codex.turn_cost',
      'event.timestamp': '2026-11-11T02:21:30.000Z',
      'turn.id': 'turn-2',
    },
  ]);

  const zipped = gzipSync(JSON.stringify(exported));

  const response = await ctx.ingest.handleRequest(
    new Request('http://ingest.test/v1/logs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tide-key',
        'imp-identity': 'token-4',
        'content-type': 'application/json; charset=utf-8',
        'content-encoding': 'gzip',
      },
      body: zipped,
    }),
  );

  const answer = await ctx.readAnswer(response);

  // the stored envelope's IDs are branded text, and the expected ones are plain literals
  const stored: unknown = await ctx.readStored();

  expect({ answer, stored }).toStrictEqual({
    answer: { status: 200, body: {} },
    stored: [
      {
        id: 'event:telemetry:codex.turn_cost:turn-2',
        type: 'telemetry.codex.turn_cost',
        v: 1,
        api: 'otlp-logs/1',
        entity: 'telemetry:session:s-9',
        at: '2026-11-11T02:21:30.000Z',
        payload: {
          resource: { attributes: [{ key: 'atc.session.id', value: { stringValue: 's-9' } }] },
          scope: { name: 'codex_otel' },
          logRecord: {
            timeUnixNano: '1794370800000000000',
            observedTimeUnixNano: '1794370800500000000',
            body: { stringValue: 'event' },
            attributes: [
              { key: 'event.name', value: { stringValue: 'codex.turn_cost' } },
              { key: 'event.timestamp', value: { stringValue: '2026-11-11T02:21:30.000Z' } },
              { key: 'turn.id', value: { stringValue: 'turn-2' } },
            ],
          },
          origin: { issuer: 'harbour-host', subject: 'imp-0193' },
        },
      },
    ],
  });
});

test('it stores the origin from the proof, never one that the export or a header names', async () => {
  const ctx = setupTest();

  const exported = {
    resourceLogs: [
      {
        resource: { attributes: [{ key: 'atc.session.id', value: { stringValue: 's-9' } }] },
        origin: { issuer: 'forged-host', subject: 'imp-9999' },
        scopeLogs: [
          {
            scope: { name: 'codex_otel' },
            logRecords: [
              {
                timeUnixNano: '1794370800000000000',
                origin: { issuer: 'forged-host', subject: 'imp-9999' },
                attributes: [
                  { key: 'event.name', value: { stringValue: 'codex.turn_cost' } },
                  { key: 'turn.id', value: { stringValue: 'turn-2' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  await ctx.ingest.handleRequest(
    new Request('http://ingest.test/v1/logs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tide-key',
        'imp-identity': 'token-4',
        'content-type': 'application/json',
        'x-origin-subject': 'imp-9999',
      },
      body: JSON.stringify(exported),
    }),
  );

  const stored = await ctx.readStored();

  expect(stored.map((fact) => fact.payload)).toStrictEqual([
    expect.objectContaining({ origin: { issuer: 'harbour-host', subject: 'imp-0193' } }),
  ]);
});

test.each([{ route: '/v1/metrics' }, { route: '/v1/traces' }])(
  'it answers 200 with {} on $route and stores nothing',
  async (row) => {
    const ctx = setupTest();

    const response = await ctx.ingest.handleRequest(
      new Request(`http://ingest.test${row.route}`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer tide-key',
          'imp-identity': 'token-4',
          'content-type': 'application/json',
        },
        body: JSON.stringify({ resourceMetrics: [] }),
      }),
    );

    const answer = await ctx.readAnswer(response);

    expect({ answer, stored: await ctx.readStored() }).toStrictEqual({
      answer: { status: 200, body: {} },
      stored: [],
    });
  },
);

test.each([
  { row: 'no proof', route: '/v1/logs', headers: { authorization: 'Bearer tide-key' } },
  {
    row: 'a proof that proves no sender',
    route: '/v1/logs',
    headers: { authorization: 'Bearer tide-key', 'imp-identity': 'token-5' },
  },
  {
    row: 'a wrong token',
    route: '/v1/logs',
    headers: { authorization: 'Bearer reef-key', 'imp-identity': 'token-4' },
  },
  {
    row: 'no proof on the metrics path',
    route: '/v1/metrics',
    headers: { authorization: 'Bearer tide-key' },
  },
  {
    row: 'no proof on the traces path',
    route: '/v1/traces',
    headers: { authorization: 'Bearer tide-key' },
  },
])('it refuses $row with 401 and stores nothing', async (row) => {
  const ctx = setupTest();
  const exported = buildLogsExport('codex', { 'atc.session.id': 's-9' }, []);

  const response = await ctx.ingest.handleRequest(
    new Request(`http://ingest.test${row.route}`, {
      method: 'POST',
      headers: { ...row.headers, 'content-type': 'application/json' },
      body: JSON.stringify(exported),
    }),
  );

  expect({ status: response.status, stored: await ctx.readStored() }).toStrictEqual({
    status: 401,
    stored: [],
  });
});

test.each([
  { row: 'protobuf', contentType: 'application/x-protobuf', text: '\n\u0003abc' },
  { row: 'a body with no content type', contentType: '', text: '{"resourceLogs":[]}' },
  { row: 'a body that is not JSON', contentType: 'application/json', text: '{"resourceLogs":' },
  { row: 'JSON that is no export', contentType: 'application/json', text: '["resourceLogs"]' },
])('it refuses $row with 400 and stores nothing', async (row) => {
  const ctx = setupTest();

  const headers = new Headers({ authorization: 'Bearer tide-key', 'imp-identity': 'token-4' });

  headers.set('content-type', row.contentType);

  const response = await ctx.ingest.handleRequest(
    new Request('http://ingest.test/v1/logs', { method: 'POST', headers, body: row.text }),
  );

  expect({ status: response.status, stored: await ctx.readStored() }).toStrictEqual({
    status: 400,
    stored: [],
  });
});

test('it answers 200 with {} to an export whose records are all dropped, and logs the count of each reason', async () => {
  const ctx = setupTest();

  const exported = buildLogsExport('codex', {}, [
    { 'event.name': 'codex.user_prompt' },
    { 'event.name': 'codex.user_prompt' },
    { 'event.name': 'other.event', 'conversation.id': 'x-3' },
  ]);

  const response = await ctx.ingest.handleRequest(
    new Request('http://ingest.test/v1/logs', {
      method: 'POST',
      headers: {
        authorization: 'Bearer tide-key',
        'imp-identity': 'token-4',
        'content-type': 'application/json',
      },
      body: JSON.stringify(exported),
    }),
  );

  const answer = await ctx.readAnswer(response);

  expect({ answer, stored: await ctx.readStored(), logged: ctx.readLogged() }).toStrictEqual({
    answer: { status: 200, body: {} },
    stored: [],
    logged: [
      {
        level: 'warn',
        message: 'the source telemetry dropped log records',
        detail: { 'no-session': 2, 'unknown-product': 1 },
      },
    ],
  });
});
