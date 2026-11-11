import { expect, test } from 'bun:test';
import { products } from '../products/products.ts';
import { buildLogsExport } from '../test-utils/build-logs-export.ts';
import { readOtlpFacts } from './read-otlp-facts.ts';
import type { LogsExport } from './types.ts';

function setupTest() {
  return {
    read: (body: LogsExport) =>
      readOtlpFacts(body, { products, sessionAttribute: 'atc.session.id' }),
  };
}

test('it stores a listed event under its type, keyed by the event key, with the record whole', () => {
  const ctx = setupTest();

  const body = buildLogsExport('claude_code', { 'atc.session.id': 's-9' }, [
    {
      'event.name': 'api_request',
      'session.id': 'c-1',
      'event.timestamp': '2026-11-11T02:20:00.000Z',
      request_id: 'req_01',
    },
  ]);

  expect(ctx.read(body)).toStrictEqual({
    facts: [
      {
        type: 'telemetry.claude_code.api_request',
        event: 'claude_code.api_request:req_01',
        entity: 'telemetry:session:s-9',
        at: '2026-11-11T02:20:00.000Z',
        payload: {
          resource: { attributes: [{ key: 'atc.session.id', value: { stringValue: 's-9' } }] },
          scope: { name: 'com.anthropic.claude_code.events' },
          logRecord: {
            timeUnixNano: '1794370800000000000',
            observedTimeUnixNano: '1794370800500000000',
            body: { stringValue: 'event' },
            attributes: [
              { key: 'event.name', value: { stringValue: 'api_request' } },
              { key: 'session.id', value: { stringValue: 'c-1' } },
              { key: 'event.timestamp', value: { stringValue: '2026-11-11T02:20:00.000Z' } },
              { key: 'request_id', value: { stringValue: 'req_01' } },
            ],
          },
        },
      },
    ],
    dropped: [],
  });
});

test.each([
  {
    row: 'the resource',
    resource: { 'atc.session.id': 's-1' },
    record: { 'atc.session.id': 's-2', 'conversation.id': 'x-3' },
    entity: 'telemetry:session:s-1',
  },
  {
    row: 'the record',
    resource: {},
    record: { 'atc.session.id': 's-2', 'conversation.id': 'x-3' },
    entity: 'telemetry:session:s-2',
  },
  {
    row: "the product's own session",
    resource: {},
    record: { 'conversation.id': 'x-3' },
    entity: 'telemetry:session:x-3',
  },
])('it takes the session from $row first', (row) => {
  const ctx = setupTest();

  const body = buildLogsExport('codex', row.resource, [
    { 'event.name': 'codex.user_prompt', 'event.timestamp': '2026-11-11T02:20:00Z', ...row.record },
  ]);

  expect(ctx.read(body).facts.map((fact) => fact.entity)).toStrictEqual([row.entity]);
});

test('it stores an event the product does not list as unlisted, keyed by a hash', () => {
  const ctx = setupTest();

  const body = buildLogsExport('codex', {}, [
    {
      'event.name': 'codex.new_thing',
      'conversation.id': 'x-3',
      'event.timestamp': '2026-11-11T02:20:00Z',
    },
  ]);

  expect(ctx.read(body).facts.map((fact) => [fact.type, fact.event])).toStrictEqual([
    ['telemetry.codex.unlisted', expect.stringMatching(/^codex\.new_thing:h-[0-9a-f]{64}$/u)],
  ]);
});

test('it keys a listed event by a hash when the record has no event key', () => {
  const ctx = setupTest();

  const body = buildLogsExport('claude_code', {}, [
    { 'event.name': 'api_request', 'session.id': 'c-1', 'event.timestamp': '2026-11-11T02:20:00Z' },
  ]);

  expect(ctx.read(body).facts.map((fact) => fact.event)).toStrictEqual([
    expect.stringMatching(/^claude_code\.api_request:h-[0-9a-f]{64}$/u),
  ]);
});

test('it gives one ID to a record that a sink forwards with a new resource and observed time', () => {
  const ctx = setupTest();
  const record = { 'event.name': 'codex.user_prompt', 'conversation.id': 'x-3', prompt_length: 40 };
  const first = buildLogsExport('codex', { 'host.name': 'worker-a' }, [record]);
  const forwarded = buildLogsExport('codex', { 'host.name': 'relay-b', 'sink.hop': 1 }, [record]);
  const raw = forwarded.resourceLogs[0]?.scopeLogs[0]?.logRecords[0];

  const reobserved: LogsExport = {
    resourceLogs: [
      {
        resource: forwarded.resourceLogs[0]?.resource ?? { attributes: [] },
        scopeLogs: [
          {
            scope: { name: 'codex_otel' },
            logRecords: [{ ...raw, observedTimeUnixNano: '1794370900000000000' }],
          },
        ],
      },
    ],
  };

  expect(ctx.read(reobserved).facts.map((fact) => fact.event)).toStrictEqual(
    ctx.read(first).facts.map((fact) => fact.event),
  );
});

test('it gives two IDs to two records that differ in one attribute', () => {
  const ctx = setupTest();

  const body = buildLogsExport('codex', {}, [
    { 'event.name': 'codex.user_prompt', 'conversation.id': 'x-3', prompt_length: 40 },
    { 'event.name': 'codex.user_prompt', 'conversation.id': 'x-3', prompt_length: 41 },
  ]);

  expect(new Set(ctx.read(body).facts.map((fact) => fact.event)).size).toBe(2);
});

test.each([
  {
    row: 'an ISO time with an offset',
    timestamp: '2026-11-11T04:20:00+02:00',
    at: '2026-11-11T02:20:00.000Z',
  },
  { row: 'no product time', timestamp: undefined, at: '2026-11-11T04:20:00.000Z' },
  { row: 'a product time that does not parse', timestamp: 'soon', at: '2026-11-11T04:20:00.000Z' },
])('it reads the time from $row', (row) => {
  const ctx = setupTest();

  const body = buildLogsExport('codex', {}, [
    {
      'event.name': 'codex.user_prompt',
      'conversation.id': 'x-3',
      ...(row.timestamp === undefined ? {} : { 'event.timestamp': row.timestamp }),
    },
  ]);

  expect(ctx.read(body).facts.map((fact) => fact.at)).toStrictEqual([row.at]);
});

test.each([
  { row: 'decimal text', timeUnixNano: '1794370800000000000' },
  { row: 'a number', timeUnixNano: 1_794_370_800_000_000_000 },
])('it reads timeUnixNano written as $row', (row) => {
  const ctx = setupTest();

  const body: LogsExport = {
    resourceLogs: [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            scope: { name: 'codex_otel' },
            logRecords: [
              {
                timeUnixNano: row.timeUnixNano,
                attributes: [
                  { key: 'event.name', value: { stringValue: 'codex.user_prompt' } },
                  { key: 'conversation.id', value: { stringValue: 'x-3' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  expect(ctx.read(body).facts.map((fact) => fact.at)).toStrictEqual(['2026-11-11T04:20:00.000Z']);
});

test('it drops a record of no known product, with no session, or with no time, and keeps the rest', () => {
  const ctx = setupTest();

  const body: LogsExport = {
    resourceLogs: [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            scope: { name: 'codex_otel' },
            logRecords: [
              { attributes: [{ key: 'event.name', value: { stringValue: 'gitpod.start' } }] },
              {
                timeUnixNano: '1794370800000000000',
                attributes: [{ key: 'event.name', value: { stringValue: 'codex.user_prompt' } }],
              },
              {
                timeUnixNano: '0',
                attributes: [
                  { key: 'event.name', value: { stringValue: 'codex.tool_result' } },
                  { key: 'conversation.id', value: { stringValue: 'x-3' } },
                ],
              },
              {
                timeUnixNano: '1794370800000000000',
                attributes: [
                  { key: 'event.name', value: { stringValue: 'codex.tool_result' } },
                  { key: 'conversation.id', value: { stringValue: 'x-3' } },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const read = ctx.read(body);

  expect({ types: read.facts.map((fact) => fact.type), dropped: read.dropped }).toStrictEqual({
    types: ['telemetry.codex.tool_result'],
    dropped: [
      { reason: 'unknown-product' },
      { reason: 'no-session', product: 'codex', event: 'user_prompt' },
      { reason: 'no-time', product: 'codex', event: 'tool_result' },
    ],
  });
});
