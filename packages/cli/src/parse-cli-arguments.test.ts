import { expect, test } from 'bun:test';
import { usage } from './build/parse-build-arguments.ts';
import { parseCLIArguments } from './parse-cli-arguments.ts';
import { startUsage } from './start/parse-start-arguments.ts';

test('it parses the build command', () => {
  expect(parseCLIArguments(['build', 'a.ts', '--check'])).toStrictEqual({
    ok: true,
    value: { kind: 'build', arguments: { file: 'a.ts', isCheck: true, out: undefined } },
  });
});

test('it parses the start command', () => {
  expect(parseCLIArguments(['start', 'a.ts'])).toStrictEqual({
    ok: true,
    value: { kind: 'start', arguments: { file: 'a.ts' } },
  });
});

test.each([[[]], [['deploy']]])('it returns both usages for %j', (args) => {
  expect(parseCLIArguments(args)).toStrictEqual({
    ok: false,
    failure: `${usage}\n${startUsage}`,
  });
});

test('it returns the usage of the command that fails', () => {
  expect(parseCLIArguments(['start'])).toStrictEqual({ ok: false, failure: startUsage });
});
