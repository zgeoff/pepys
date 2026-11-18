import { expect, test } from 'bun:test';
import { collectRetention } from './collect-retention.ts';

test.each([
  [
    'marks an earlier file that is sent and has no sentAt',
    { '2026-03-01-logs.jsonl': { offset: 10 } },
    { markSent: ['2026-03-01-logs.jsonl'], remove: [] },
  ],
  [
    'removes a file whose sentAt is 7 days old',
    { '2026-03-01-logs.jsonl': { offset: 10, sentAt: '2026-03-03T00:00:00Z' } },
    { markSent: [], remove: ['2026-03-01-logs.jsonl'] },
  ],
  [
    'keeps a file whose sentAt is 6 days old',
    { '2026-03-01-logs.jsonl': { offset: 10, sentAt: '2026-03-04T00:00:00Z' } },
    { markSent: [], remove: [] },
  ],
  [
    'keeps a file that holds an unsent line, whatever its sentAt',
    { '2026-03-01-logs.jsonl': { offset: 4, sentAt: '2026-02-01T00:00:00Z' } },
    { markSent: [], remove: [] },
  ],
  [
    'keeps a file with an offset past its end',
    { '2026-03-01-logs.jsonl': { offset: 99, sentAt: '2026-02-01T00:00:00Z' } },
    { markSent: [], remove: [] },
  ],
  [
    'leaves the file of the current day alone',
    { '2026-03-10-logs.jsonl': { offset: 10 } },
    { markSent: [], remove: [] },
  ],
])('#collectRetention %s', (_name, positions, expected) => {
  const files = [
    { name: '2026-03-01-logs.jsonl', day: '2026-03-01', size: 10 },
    { name: '2026-03-10-logs.jsonl', day: '2026-03-10', size: 10 },
  ];

  expect(
    collectRetention(files, positions, '2026-03-10', Date.parse('2026-03-10T00:00:00Z')),
  ).toStrictEqual(expected);
});

test('#collectRetention treats a file with no position as unsent', () => {
  const files = [{ name: '2026-03-01-logs.jsonl', day: '2026-03-01', size: 10 }];

  expect(
    collectRetention(files, {}, '2026-03-10', Date.parse('2026-03-10T00:00:00Z')),
  ).toStrictEqual({
    markSent: [],
    remove: [],
  });
});
