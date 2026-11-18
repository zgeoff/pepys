import { expect, test } from 'bun:test';
import { collectSpoolFileNames } from './collect-spool-file-names.ts';

test('#collectSpoolFileNames returns the log files newest first and leaves every other name out', () => {
  const names = collectSpoolFileNames([
    '2026-03-01-logs.jsonl',
    '2026-03-02-metrics.jsonl',
    'positions.json',
    'failed',
    '2026-03-03-logs.jsonl',
    'notes-logs.jsonl',
    '2026-03-02-logs.jsonl.bak',
  ]);

  expect(names).toStrictEqual(['2026-03-03-logs.jsonl', '2026-03-01-logs.jsonl']);
});
