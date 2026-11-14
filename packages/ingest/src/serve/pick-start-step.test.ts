import { expect, test } from 'bun:test';
import { S2Error } from '@s2-dev/streamstore';
import { pickStartStep } from './pick-start-step.ts';

test.each([
  { failures: 1, delayMs: 200 },
  { failures: 2, delayMs: 400 },
  { failures: 8, delayMs: 25_600 },
  { failures: 9, delayMs: 30_000 },
])('it waits $delayMs ms after $failures refused connections in a row', (row) => {
  const refused = new S2Error({
    message: 'Connection failed',
    code: 'ECONNREFUSED',
    status: 502,
    origin: 'sdk',
  });

  expect(pickStartStep(refused, row.failures)).toStrictEqual({
    kind: 'retry',
    delayMs: row.delayMs,
  });
});

test.each([
  { status: 500, origin: 'server' as const },
  { status: 503, origin: 'server' as const },
  { status: 408, origin: 'server' as const },
  { status: 429, origin: 'server' as const },
  { status: 0, origin: 'sdk' as const },
])('it tries again after a status $status from the $origin', (row) => {
  const error = new S2Error({ message: 'the call failed', ...row });

  expect(pickStartStep(error, 1)).toStrictEqual({ kind: 'retry', delayMs: 200 });
});

test.each([{ status: 401 }, { status: 403 }, { status: 404 }])(
  'it stops at once on a status $status from the server',
  (row) => {
    const error = new S2Error({ message: 'the server refused the call', ...row, origin: 'server' });

    expect(pickStartStep(error, 1)).toStrictEqual({ kind: 'stop' });
  },
);

test('it stops at once on an error that the fact log did not raise', () => {
  expect(pickStartStep(new Error('the log holds the cursor stream'), 1)).toStrictEqual({
    kind: 'stop',
  });
});

test('it stops after 10 refused connections in a row', () => {
  const refused = new S2Error({ message: 'Connection failed', status: 502, origin: 'sdk' });

  expect(pickStartStep(refused, 10)).toStrictEqual({ kind: 'stop' });
});
