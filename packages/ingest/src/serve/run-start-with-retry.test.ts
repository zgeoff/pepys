import { expect, test } from 'bun:test';
import { createLogger } from '@pepys/kit';
import { S2Error } from '@s2-dev/streamstore';
import { createS2FactLog } from '../fact-log/s2/create-s2-fact-log.ts';
import { runStartWithRetry } from './run-start-with-retry.ts';

function setupTest() {
  const lines: string[] = [];
  const waits: number[] = [];

  const stopping = new AbortController();

  // a port that was free a moment ago, so a connection to it is refused
  const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: () => {} } });
  const closedEndpoint = `http://127.0.0.1:${listener.port}`;

  listener.stop(true);

  const logger = createLogger({ write: (line) => lines.push(line) });

  return {
    waits,
    signal: stopping.signal,
    logger,
    stop: () => {
      stopping.abort();
    },
    openRefusedLog: () =>
      createS2FactLog({
        endpoint: closedEndpoint,
        accessToken: 'quay-token',
        basin: 'start-retry',
        streams: [],
        logger,
      }),
    skipWait: (delayMs: number): Promise<void> => {
      waits.push(delayMs);

      return Promise.resolve();
    },
    readLogged: () => lines.map((line): unknown => JSON.parse(line)),
  };
}

test('it starts once the fact log answers, after the log refused the first 2 connections', async () => {
  const ctx = setupTest();
  let starts = 0;

  const run = await runStartWithRetry(
    async () => {
      starts += 1;

      if (starts <= 2) {
        await ctx.openRefusedLog();
      }

      return 'cursors read';
    },
    { wait: ctx.skipWait, signal: ctx.signal, logger: ctx.logger },
  );

  expect(run).toStrictEqual({ kind: 'started', value: 'cursors read' });
  expect(ctx.waits).toStrictEqual([200, 400]);

  expect(ctx.readLogged()).toStrictEqual([
    {
      level: 'error',
      message: 'the fact log failed the start of ingest, which tries again in 200 ms',
      detail: expect.any(Object),
    },
    {
      level: 'error',
      message: 'the fact log failed the start of ingest, which tries again in 400 ms',
      detail: expect.any(Object),
    },
  ]);
});

test('it fails with the last error after the fact log refused 10 connections in a row', async () => {
  const ctx = setupTest();
  let starts = 0;

  const run = await runStartWithRetry(
    () => {
      starts += 1;

      return Promise.reject(
        new S2Error({ message: `refusal ${starts}`, status: 502, origin: 'sdk' }),
      );
    },
    { wait: ctx.skipWait, signal: ctx.signal, logger: ctx.logger },
  );

  expect(run).toStrictEqual({
    kind: 'failed',
    error: expect.objectContaining({ message: 'refusal 10' }),
  });

  expect(ctx.waits).toStrictEqual([200, 400, 800, 1600, 3200, 6400, 12_800, 25_600, 30_000]);
});

test('it fails at once, with no wait, when the fact log refuses the access token', async () => {
  const ctx = setupTest();

  const run = await runStartWithRetry(
    () =>
      Promise.reject(new S2Error({ message: 'the token is wrong', status: 401, origin: 'server' })),
    { wait: ctx.skipWait, signal: ctx.signal, logger: ctx.logger },
  );

  expect(run).toStrictEqual({
    kind: 'failed',
    error: expect.objectContaining({ message: 'the token is wrong' }),
  });

  expect(ctx.waits).toStrictEqual([]);
});

test('it ends a wait for the fact log when ingest stops, and starts no more', async () => {
  const ctx = setupTest();
  let starts = 0;

  const running = runStartWithRetry(
    () => {
      starts += 1;

      return Promise.reject(new S2Error({ message: 'refused', status: 502, origin: 'sdk' }));
    },
    {
      // a wait that the stop aborts: the timer of ingest rejects when its signal aborts
      wait: (_delayMs, _value, options) => {
        ctx.stop();

        return options.signal.aborted
          ? Promise.reject(new Error('the wait was aborted'))
          : Promise.resolve();
      },
      signal: ctx.signal,
      logger: ctx.logger,
    },
  );

  const run = await running;

  expect(run).toStrictEqual({ kind: 'stopped' });
  expect(starts).toBe(1);
});
