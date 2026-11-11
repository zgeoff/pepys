import { expect, test } from 'bun:test';
import { parseLogsExport } from './parse-logs-export.ts';

test.each([
  { row: 'a list', value: [] },
  { row: 'text', value: 'resourceLogs' },
  { row: 'null', value: null },
  { row: 'resourceLogs that is no list', value: { resourceLogs: { scopeLogs: [] } } },
])('it finds no export in $row', (row) => {
  expect(parseLogsExport(row.value)).toBeUndefined();
});

test('it reads an object with no resourceLogs as an empty export', () => {
  expect(parseLogsExport({})).toStrictEqual({ resourceLogs: [] });
});

test('it skips each part of the wrong shape and keeps the rest of the record as it came', () => {
  const parsed = parseLogsExport({
    resourceLogs: [
      7,
      {
        resource: { attributes: [{ key: 'host.name', value: { stringValue: 'worker-a' } }, 'odd'] },
        scopeLogs: [
          { scope: { name: 7 }, logRecords: 'none' },
          {
            scope: { name: 'codex_otel', version: '0.9.0' },
            logRecords: [
              null,
              {
                timeUnixNano: 1_794_370_800_000_000_000,
                severityText: 'INFO',
                attributes: [
                  { value: { stringValue: 'no key' } },
                  { key: 'turn.id', value: { intValue: 4 } },
                ],
              },
            ],
          },
        ],
      },
    ],
  });

  expect(parsed).toStrictEqual({
    resourceLogs: [
      {
        resource: { attributes: [{ key: 'host.name', value: { stringValue: 'worker-a' } }] },
        scopeLogs: [
          { scope: { name: '' }, logRecords: [] },
          {
            scope: { name: 'codex_otel', version: '0.9.0' },
            logRecords: [
              {
                timeUnixNano: 1_794_370_800_000_000_000,
                severityText: 'INFO',
                attributes: [{ key: 'turn.id', value: { intValue: 4 } }],
              },
            ],
          },
        ],
      },
    ],
  });
});
