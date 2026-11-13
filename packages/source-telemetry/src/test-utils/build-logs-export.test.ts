import { expect, test } from 'bun:test';
import { buildLogsExport } from './build-logs-export.ts';

test('it writes each attribute as the OTLP JSON value of its type', () => {
  const built = buildLogsExport('codex', { 'service.name': 'codex' }, [
    { 'event.name': 'codex.sse_event', input_token_count: 40, rate: 0.5, is_final: true },
  ]);

  expect(built).toStrictEqual({
    resourceLogs: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'codex' } }] },
        scopeLogs: [
          {
            scope: { name: 'codex_otel.log_only' },
            logRecords: [
              {
                timeUnixNano: '1794370800000000000',
                observedTimeUnixNano: '1794370800500000000',
                body: {},
                attributes: [
                  { key: 'event.name', value: { stringValue: 'codex.sse_event' } },
                  { key: 'input_token_count', value: { intValue: '40' } },
                  { key: 'rate', value: { doubleValue: 0.5 } },
                  { key: 'is_final', value: { boolValue: true } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
});

test('it writes a Claude Code integer as a JSON number, and the full event name in the body', () => {
  const built = buildLogsExport('claude_code', {}, [
    { 'event.name': 'api_request', input_tokens: 12 },
  ]);

  expect(built).toStrictEqual({
    resourceLogs: [
      {
        resource: { attributes: [] },
        scopeLogs: [
          {
            scope: { name: 'com.anthropic.claude_code.events' },
            logRecords: [
              {
                timeUnixNano: '1794370800000000000',
                observedTimeUnixNano: '1794370800500000000',
                body: { stringValue: 'claude_code.api_request' },
                attributes: [
                  { key: 'event.name', value: { stringValue: 'api_request' } },
                  { key: 'input_tokens', value: { intValue: 12 } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });
});
