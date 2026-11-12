import { expect, test } from 'bun:test';
import { createLogger } from './create-logger.ts';

function setupTest() {
  const lines: string[] = [];

  return { lines, logger: createLogger({ write: (line) => lines.push(line) }) };
}

test.each(['error', 'warn'] as const)(
  'it writes one JSON line with the level of a %s call',
  (level) => {
    const ctx = setupTest();

    ctx.logger[level]('the tide gauge went quiet', { gauge: 'north', missed: 3 });

    expect(ctx.lines).toStrictEqual([
      `{"level":"${level}","message":"the tide gauge went quiet","detail":{"gauge":"north","missed":3}}\n`,
    ]);
  },
);

test('it leaves the detail out of a line whose call passes none', () => {
  const ctx = setupTest();

  ctx.logger.error('the harbour log closed');

  expect(ctx.lines).toStrictEqual(['{"level":"error","message":"the harbour log closed"}\n']);
});

test('it writes the name, message and cause of an error detail', () => {
  const ctx = setupTest();

  ctx.logger.error(
    'an append failed',
    new TypeError('the buoy is offline', { cause: 'no signal' }),
  );

  const [line] = ctx.lines;
  const parsed: unknown = JSON.parse(line ?? '');

  expect(parsed).toStrictEqual({
    level: 'error',
    message: 'an append failed',
    detail: {
      name: 'TypeError',
      message: 'the buoy is offline',
      stack: expect.stringContaining('TypeError: the buoy is offline'),
      cause: 'no signal',
    },
  });
});

test('it writes a bigint in a detail as its digits', () => {
  const ctx = setupTest();

  ctx.logger.warn('a delivery ID is past 2^53', { id: 6_815_230_947_712_500_482n });

  expect(ctx.lines).toStrictEqual([
    '{"level":"warn","message":"a delivery ID is past 2^53","detail":{"id":"6815230947712500482"}}\n',
  ]);
});

test('it writes a detail that refers to itself as text, and does not throw', () => {
  const ctx = setupTest();
  const looped: Record<string, unknown> = { pier: 'east' };

  looped['self'] = looped;

  ctx.logger.error('a loop in the detail', looped);

  const [line] = ctx.lines;
  const parsed: unknown = JSON.parse(line ?? '');

  expect(parsed).toStrictEqual({
    level: 'error',
    message: 'a loop in the detail',
    detail: expect.stringContaining("pier: 'east'"),
  });
});
