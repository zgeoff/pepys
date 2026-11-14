import { expect, test } from 'bun:test';
import { buildTelemetryExport } from './build-telemetry-export.ts';

test('it builds one Claude Code logs export with a record per model request', () => {
  const built = buildTelemetryExport('s-tide', [
    {
      id: 'req_tide_01',
      model: 'model-large',
      inputTokens: 5,
      outputTokens: 60,
      cacheReadTokens: 0,
      cacheCreationTokens: 2,
      costUsd: 0.25,
      at: '2026-11-11T02:20:00.000Z',
    },
  ]);

  expect(built).toStrictEqual({
    resourceLogs: [
      {
        resource: { attributes: [{ key: 'atc.session.id', value: { stringValue: 's-tide' } }] },
        scopeLogs: [
          {
            scope: { name: 'com.anthropic.claude_code.events' },
            logRecords: [
              {
                timeUnixNano: '1794363600000000000',
                observedTimeUnixNano: '1794363600000000000',
                body: { stringValue: 'claude_code.api_request' },
                attributes: [
                  { key: 'event.name', value: { stringValue: 'api_request' } },
                  { key: 'session.id', value: { stringValue: 's-tide' } },
                  { key: 'event.timestamp', value: { stringValue: '2026-11-11T02:20:00.000Z' } },
                  { key: 'request_id', value: { stringValue: 'req_tide_01' } },
                  { key: 'model', value: { stringValue: 'model-large' } },
                  { key: 'input_tokens', value: { intValue: 5 } },
                  { key: 'output_tokens', value: { intValue: 60 } },
                  { key: 'cache_read_tokens', value: { intValue: 0 } },
                  { key: 'cache_creation_tokens', value: { intValue: 2 } },
                  { key: 'cost_usd', value: { doubleValue: 0.25 } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
});

test('it leaves out the cost of a request that reports none', () => {
  const built = buildTelemetryExport('s-tide', [
    {
      id: 'req_tide_02',
      model: 'model-small',
      inputTokens: 1,
      outputTokens: 1,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      at: '2026-11-11T02:20:00.000Z',
    },
  ]);

  expect(
    built.resourceLogs[0]?.scopeLogs[0]?.logRecords[0]?.attributes.map((entry) => entry.key),
  ).toStrictEqual([
    'event.name',
    'session.id',
    'event.timestamp',
    'request_id',
    'model',
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_creation_tokens',
  ]);
});
