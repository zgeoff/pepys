import { expect, onTestFinished, test } from 'bun:test';
import { createLogger, toStreamName } from '@pepys/kit';
import type { PullPath } from '@pepys/kit';
import { waitFor } from '@zgeoff/testing/helpers';
import { createMemoryFactLog } from '../fact-log/memory/create-memory-fact-log.ts';
import { collectTimedPulls } from '../pull/collect-timed-pulls.ts';
import { cursorStream } from '../pull/cursors/cursor-stream.ts';
import { readSavedCursors } from '../pull/cursors/read-saved-cursors.ts';
import { createIngest } from '../receive/create-ingest.ts';
import { noSenderProof } from '../sender-proof/none/no-sender-proof.ts';
import { buildStubPullDeployment } from '../test-utils/build-stub-pull-deployment.ts';
import type { StubPulls } from '../test-utils/build-stub-pull-deployment.ts';
import { buildTestFact } from '../test-utils/build-test-fact.ts';
import { startPullTimers } from './start-pull-timers.ts';

function setupTest() {
  const lines: string[] = [];
  const logger = createLogger({ write: (line) => lines.push(line) });
  const tide = toStreamName('facts.almanac.tide');
  const log = createMemoryFactLog([tide, cursorStream]);

  // one ingest over the test's log, as a start of the process makes one
  const startTimersOver = async (pullsBySource: Readonly<Record<string, StubPulls>>) => {
    const deployment = buildStubPullDeployment(pullsBySource);

    const ingest = createIngest({
      deployment,
      secrets: {},
      log,
      senderProof: noSenderProof,
      appendRetry: { maxAttempts: 1, retryDelayMs: 0 },
      now: () => 0,
      logger,
    });

    const pulls = await readSavedCursors(log, collectTimedPulls(deployment.sources));

    const stop = startPullTimers(pulls, ingest.runPull, logger);

    onTestFinished(stop);

    return { stop, runPull: ingest.runPull };
  };

  return {
    tide,
    readLogged: () => lines.map((line): unknown => JSON.parse(line)),
    startTimersOver,
    startTimers: async (pull: PullPath['pull']) => {
      const timers = await startTimersOver({ almanac: { live: { intervalMs: 1, pull } } });

      return timers.stop;
    },
  };
}

test('it makes a run through runPull wait for a timed run of the same source', async () => {
  const ctx = setupTest();
  const events: string[] = [];
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();

  const timers = await ctx.startTimersOver({
    almanac: {
      live: {
        intervalMs: 1,
        pull: async () => {
          events.push('live starts');
          started.resolve();

          await release.promise;

          events.push('live ends');

          return { kind: 'unavailable', retryAfterMs: 1 };
        },
      },
      recovery: {
        intervalMs: null,
        pull: () => {
          events.push('recovery starts');

          return Promise.resolve({ kind: 'unavailable', retryAfterMs: 1 });
        },
      },
    },
    tally: {
      live: { intervalMs: null, pull: () => Promise.resolve({ kind: 'expired' }) },
    },
  });

  await started.promise;

  const signal = new AbortController().signal;

  const run = timers.runPull('almanac', 'recovery', null, signal);

  await timers.runPull('tally', 'live', null, signal);

  release.resolve();

  await run;

  expect(events.slice(0, 3)).toStrictEqual(['live starts', 'live ends', 'recovery starts']);
});

test('it settles a stop while a timed run waits for its source, and that run never starts', async () => {
  const ctx = setupTest();
  const events: string[] = [];
  const later = Promise.withResolvers<void>();

  // The timers fire in the order of their intervals, so once the 5 ms timer of the other source
  // has run, the 1 ms recovery timer has fired and its run waits behind the live run.
  const timers = await ctx.startTimersOver({
    almanac: {
      live: {
        intervalMs: 1,
        pull: async (_cursor, context) => {
          events.push('live starts');

          await new Promise((resolve) => {
            context.signal.addEventListener('abort', resolve);
          });

          events.push('live ends');

          return { kind: 'unavailable', retryAfterMs: 1 };
        },
      },
      recovery: {
        intervalMs: 1,
        pull: () => {
          events.push('recovery starts');

          return Promise.resolve({ kind: 'unavailable', retryAfterMs: 1 });
        },
      },
    },
    tally: {
      live: {
        intervalMs: 5,
        pull: () => {
          later.resolve();

          return Promise.resolve({ kind: 'unavailable', retryAfterMs: 1 });
        },
      },
    },
  });

  await later.promise;

  await timers.stop();

  expect(events).toStrictEqual(['live starts', 'live ends']);
});

test('it passes the first run after a restart the cursor that the last stored run saved', async () => {
  const ctx = setupTest();
  const stored = Promise.withResolvers<void>();

  const stopFirst = await ctx.startTimers(() => {
    stored.resolve();

    return Promise.resolve({
      kind: 'batch',
      batch: {
        facts: [{ stream: ctx.tide, blobs: [], fact: buildTestFact('event:almanac:tide-1') }],
      },
      cursor: 'tide-41',
      isDone: true,
    });
  });

  await stored.promise;
  await stopFirst();

  const seen: (string | null)[] = [];

  await ctx.startTimers((cursor) => {
    seen.push(cursor);

    return Promise.resolve({ kind: 'unavailable', retryAfterMs: 1 });
  });

  await waitFor(() => {
    expect(seen[0]).toBe('tide-41');
  });
});

test('it starts the pull from no cursor after the pull reports its saved cursor expired', async () => {
  const ctx = setupTest();
  const stored = Promise.withResolvers<void>();

  const stopFirst = await ctx.startTimers(() => {
    stored.resolve();

    return Promise.resolve({
      kind: 'batch',
      batch: { facts: [] },
      cursor: 'tide-41',
      isDone: true,
    });
  });

  await stored.promise;
  await stopFirst();

  const seen: (string | null)[] = [];

  await ctx.startTimers((cursor) => {
    seen.push(cursor);

    return Promise.resolve({ kind: 'expired' });
  });

  await waitFor(() => {
    expect(seen.slice(0, 2)).toStrictEqual(['tide-41', null]);
  });
});

test('it logs a timed pull that stores nothing, with what the pull answered', async () => {
  const ctx = setupTest();

  await ctx.startTimers(() => Promise.resolve({ kind: 'unavailable', retryAfterMs: 30_000 }));

  await waitFor(() => {
    expect(ctx.readLogged()[0]).toStrictEqual({
      level: 'error',
      message: 'the live pull of almanac did not store',
      detail: { kind: 'unavailable', retryAfterMs: 30_000 },
    });
  });
});

test('it logs a timed pull that throws, with its error', async () => {
  const ctx = setupTest();

  await ctx.startTimers(() => Promise.reject(new Error('the tide table is offline')));

  await waitFor(() => {
    expect(ctx.readLogged()[0]).toStrictEqual({
      level: 'error',
      message: 'the live pull of almanac threw',
      detail: { name: 'Error', message: 'the tide table is offline', stack: expect.any(String) },
    });
  });
});

test('it aborts a pull in flight on stop, and settles once the pull ends', async () => {
  const ctx = setupTest();
  const seen = Promise.withResolvers<AbortSignal>();
  const ended: string[] = [];

  const stop = await ctx.startTimers(async (_cursor, context) => {
    seen.resolve(context.signal);

    await new Promise((resolve) => {
      context.signal.addEventListener('abort', resolve);
    });

    ended.push('pull');

    return { kind: 'unavailable', retryAfterMs: 1 };
  });

  const signal = await seen.promise;

  await stop();

  expect({ isAborted: signal.aborted, ended }).toStrictEqual({ isAborted: true, ended: ['pull'] });
});

test('it logs no failure for a pull that the stop cut short', async () => {
  const ctx = setupTest();
  const seen = Promise.withResolvers<void>();

  const stop = await ctx.startTimers(async (_cursor, context) => {
    seen.resolve();

    await new Promise((resolve) => {
      context.signal.addEventListener('abort', resolve);
    });

    return { kind: 'unavailable', retryAfterMs: 1 };
  });

  await seen.promise;
  await stop();

  expect(ctx.readLogged()).toStrictEqual([]);
});

test('it logs no failure for a pull that throws once the stop aborted it', async () => {
  const ctx = setupTest();
  const seen = Promise.withResolvers<void>();

  const stop = await ctx.startTimers(async (_cursor, context) => {
    seen.resolve();

    await new Promise((resolve) => {
      context.signal.addEventListener('abort', resolve);
    });

    throw new Error('the tide table read was aborted');
  });

  await seen.promise;
  await stop();

  expect(ctx.readLogged()).toStrictEqual([]);
});
