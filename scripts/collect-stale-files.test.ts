import { expect, test } from 'bun:test';
import { collectStaleFiles } from './collect-stale-files.ts';

test.each<[string, [string, string][], string[]]>([
  ['nothing when each committed file matches', [['gen/tide.sql', 'sql']], []],
  ['a file whose committed text differs', [['gen/tide.sql', 'old sql']], ['gen/tide.sql']],
  ['a file with no committed text', [], ['gen/tide.sql']],
])('it names %s', (_title, committed, expected) => {
  expect(
    collectStaleFiles([{ path: 'gen/tide.sql', content: 'sql' }], new Map(committed)),
  ).toStrictEqual(expected);
});
