import { expect, test } from 'bun:test';
import { parseStartArguments, startUsage } from './parse-start-arguments.ts';

test('it parses the deployment file', () => {
  expect(parseStartArguments(['start', 'src/deployment.ts'])).toStrictEqual({
    ok: true,
    value: { file: 'src/deployment.ts' },
  });
});

test.each([
  ['no file', ['start']],
  ['two files', ['start', 'a.ts', 'b.ts']],
  ['another command', ['build', 'a.ts']],
])('it returns the usage for %s', (_title, args) => {
  expect(parseStartArguments(args)).toStrictEqual({ ok: false, failure: startUsage });
});

test('it refuses an option that start does not take', () => {
  const parsed = parseStartArguments(['start', 'a.ts', '--out', 'x']);

  expect(parsed.ok).toBe(false);
});
