import { expect, test } from 'bun:test';
import { parseBuildArguments, usage } from './parse-build-arguments.ts';

test('it parses a file', () => {
  expect(parseBuildArguments(['build', 'src/plugin.ts'])).toStrictEqual({
    ok: true,
    value: { file: 'src/plugin.ts', isCheck: false },
  });
});

test('it parses --check before or after the file', () => {
  expect([
    parseBuildArguments(['build', '--check', 'src/plugin.ts']),
    parseBuildArguments(['build', 'src/plugin.ts', '--check']),
  ]).toStrictEqual([
    { ok: true, value: { file: 'src/plugin.ts', isCheck: true } },
    { ok: true, value: { file: 'src/plugin.ts', isCheck: true } },
  ]);
});

test.each([
  { title: 'no command', args: [] },
  { title: 'an unknown command', args: ['deploy', 'src/plugin.ts'] },
  { title: 'no file', args: ['build'] },
  { title: 'two files', args: ['build', 'a.ts', 'b.ts'] },
])('it refuses $title', (row) => {
  expect(parseBuildArguments(row.args)).toStrictEqual({ ok: false, failure: usage });
});

test('it refuses an unknown option and names it', () => {
  expect(parseBuildArguments(['build', 'a.ts', '--watch'])).toStrictEqual({
    ok: false,
    failure: expect.stringContaining('--watch'),
  });
});
