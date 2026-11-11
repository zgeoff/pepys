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
            scope: { name: 'codex_otel' },
            logRecords: [
              {
                timeUnixNano: '1794370800000000000',
                observedTimeUnixNano: '1794370800500000000',
                body: { stringValue: 'event' },
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
