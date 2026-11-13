import { expect, onTestFinished, test } from 'bun:test';
import { createLogger, toStreamName } from '@pepys/kit';
import type { StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import type { FactLog } from '../fact-log/fact-log.ts';
import { createMemoryFactLog } from '../fact-log/memory/create-memory-fact-log.ts';
import { createIngest } from '../receive/create-ingest.ts';
import { noSenderProof } from '../sender-proof/none/no-sender-proof.ts';
import { buildStubPullDeployment } from '../test-utils/build-stub-pull-deployment.ts';
import type { StubPulls } from '../test-utils/build-stub-pull-deployment.ts';
import { buildTestFact } from '../test-utils/build-test-fact.ts';
import { cursorStream } from './cursors/cursor-stream.ts';

function setupTest() {
  const logger = createLogger({ write: () => {} });

  return {
    tide: toStreamName('facts.almanac.tide'),
    moon: toStreamName('facts.almanac.moon'),
    createIngest: (log: FactLog, pullsBySource: Readonly<Record<string, StubPulls>>) =>
      createIngest({
        deployment: buildStubPullDeployment(pullsBySource),
        secrets: {},
        log,
        senderProof: noSenderProof,
        appendRetry: { maxAttempts: 1, retryDelayMs: 0 },
        now: () => Date.parse('2026-10-01T08:00:00Z'),
        logger,
      }),
    readFacts: async (log: FactLog, stream: StreamName) => {
      const read = await log.read(stream, toTagged<StreamOffset>(0), 100);

      invariant(read.ok, 'the stream exists');

      return read.value.map((stored): unknown => stored.fact);
    },
  };
}

test('it writes one cursor record for the source and the pull path, after the facts of a stored run', async () => {
  const ctx = setupTest();
  const memory = createMemoryFactLog([ctx.tide, cursorStream]);
  const appended: StreamName[] = [];

  const log: FactLog = {
    ...memory,
    appendBatch: (stream, facts, expectedTail) => {
      appended.push(stream);

      return memory.appendBatch(stream, facts, expectedTail);
    },
  };

  const ingest = ctx.createIngest(log, {
    almanac: {
      recovery: {
        intervalMs: null,
        pull: () =>
          Promise.resolve({
            kind: 'batch',
            batch: {
              facts: [{ stream: ctx.tide, blobs: [], fact: buildTestFact('event:almanac:tide-1') }],
            },
            cursor: 'tide-41',
            isDone: true,
          }),
      },
    },
  });

  const run = await ingest.runPull('almanac', 'recovery', null, new AbortController().signal);
  const cursors = await ctx.readFacts(log, cursorStream);

  expect(run).toStrictEqual({ kind: 'stored', stored: 1, cursor: 'tide-41', isDone: true });
  expect(appended).toStrictEqual([ctx.tide, cursorStream]);

  expect(cursors).toStrictEqual([
    {
      id: expect.stringMatching(/^observation:[0-9a-f]{64}$/u),
      type: 'ingest.cursor.saved',
      v: 1,
      api: 'ingest/1',
      entity: 'almanac:pull_path:recovery',
      at: '2026-10-01T08:00:00.000Z',
      cursor: 'tide-41',
      payload: {},
    },
  ]);
});

test.each([
  { row: 'its only append', streams: [] },
  { row: 'one append of two', streams: [toStreamName('facts.almanac.tide')] },
])('it writes no cursor record for a run whose facts fail $row', async (row) => {
  const ctx = setupTest();
  const log = createMemoryFactLog([...row.streams, cursorStream]);

  const ingest = ctx.createIngest(log, {
    almanac: {
      recovery: {
        intervalMs: null,
        pull: () =>
          Promise.resolve({
            kind: 'batch',
            batch: {
              facts: [
                { stream: ctx.tide, blobs: [], fact: buildTestFact('event:almanac:tide-1') },
                { stream: ctx.moon, blobs: [], fact: buildTestFact('event:almanac:moon-1') },
              ],
            },
            cursor: 'tide-41',
            isDone: true,
          }),
      },
    },
  });

  const run = await ingest.runPull('almanac', 'recovery', null, new AbortController().signal);
  const cursors = await ctx.readFacts(log, cursorStream);

  expect(run).toStrictEqual({ kind: 'refused', reason: 'the log refused the batch' });
  expect(cursors).toStrictEqual([]);
});

test('it writes no cursor record for a run that ends on the cursor it started from', async () => {
  const ctx = setupTest();
  const log = createMemoryFactLog([ctx.tide, cursorStream]);

  const ingest = ctx.createIngest(log, {
    almanac: {
      recovery: {
        intervalMs: null,
        pull: () =>
          Promise.resolve({ kind: 'batch', batch: { facts: [] }, cursor: 'tide-41', isDone: true }),
      },
    },
  });

  const run = await ingest.runPull('almanac', 'recovery', 'tide-41', new AbortController().signal);
  const cursors = await ctx.readFacts(log, cursorStream);

  expect(run).toStrictEqual({ kind: 'stored', stored: 0, cursor: 'tide-41', isDone: true });
  expect(cursors).toStrictEqual([]);
});

test('it refuses a run whose cursor record the log refuses', async () => {
  const ctx = setupTest();
  const log = createMemoryFactLog([ctx.tide]);

  const ingest = ctx.createIngest(log, {
    almanac: {
      recovery: {
        intervalMs: null,
        pull: () =>
          Promise.resolve({ kind: 'batch', batch: { facts: [] }, cursor: 'tide-41', isDone: true }),
      },
    },
  });

  const run = await ingest.runPull('almanac', 'recovery', null, new AbortController().signal);

  expect(run).toStrictEqual({ kind: 'refused', reason: 'the log refused the cursor record' });
});

test('it answers not-stored for a run whose cursor record gets no acknowledgement', async () => {
  const ctx = setupTest();
  const log = createMemoryFactLog([ctx.tide, cursorStream]);

  const ingest = ctx.createIngest(log, {
    almanac: {
      recovery: {
        intervalMs: null,
        pull: () =>
          Promise.resolve({ kind: 'batch', batch: { facts: [] }, cursor: 'tide-41', isDone: true }),
      },
    },
  });

  log.dropNextAppend({ thenAppend: [buildTestFact('event:almanac:stray-1')] });

  const run = await ingest.runPull('almanac', 'recovery', null, new AbortController().signal);

  expect(run).toStrictEqual({ kind: 'not-stored' });
});

test('it runs a second pull path of a source only after the first one ends', async () => {
  const ctx = setupTest();
  const events: string[] = [];
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();

  const ingest = ctx.createIngest(createMemoryFactLog([cursorStream]), {
    almanac: {
      live: {
        intervalMs: null,
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

  const signal = new AbortController().signal;

  const first = ingest.runPull('almanac', 'live', null, signal);

  await started.promise;

  const second = ingest.runPull('almanac', 'recovery', null, signal);

  await ingest.runPull('tally', 'live', null, signal);

  release.resolve();

  await Promise.all([first, second]);

  expect(events).toStrictEqual(['live starts', 'live ends', 'recovery starts']);
});

test('it runs the pull paths of two sources at the same time', async () => {
  const ctx = setupTest();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();

  const ingest = ctx.createIngest(createMemoryFactLog([cursorStream]), {
    almanac: {
      live: {
        intervalMs: null,
        pull: async () => {
          started.resolve();

          await release.promise;

          return { kind: 'unavailable', retryAfterMs: 1 };
        },
      },
    },
    tally: {
      live: { intervalMs: null, pull: () => Promise.resolve({ kind: 'expired' }) },
    },
  });

  const signal = new AbortController().signal;

  const held = ingest.runPull('almanac', 'live', null, signal);

  onTestFinished(async () => {
    release.resolve();

    await held;
  });

  await started.promise;

  const run = await ingest.runPull('tally', 'live', null, signal);

  expect(run).toStrictEqual({ kind: 'expired' });
});

test('it refuses a run whose signal aborts while it waits, and never starts its pull', async () => {
  const ctx = setupTest();
  const events: string[] = [];
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();

  const ingest = ctx.createIngest(createMemoryFactLog([cursorStream]), {
    almanac: {
      live: {
        intervalMs: null,
        pull: async () => {
          started.resolve();

          await release.promise;

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
  });

  const held = ingest.runPull('almanac', 'live', null, new AbortController().signal);

  await started.promise;

  const waiting = new AbortController();

  const stopped = ingest.runPull('almanac', 'recovery', null, waiting.signal);

  waiting.abort();

  const run = await stopped;

  release.resolve();

  await held;

  expect(run).toStrictEqual({
    kind: 'refused',
    reason: 'the recovery pull of almanac stopped before its turn',
  });

  expect(events).toStrictEqual([]);
});

test('it keeps a run behind a stopped one waiting until the run ahead of both ends', async () => {
  const ctx = setupTest();
  const events: string[] = [];
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();

  const ingest = ctx.createIngest(createMemoryFactLog([cursorStream]), {
    almanac: {
      live: {
        intervalMs: null,
        pull: async () => {
          started.resolve();

          await release.promise;

          events.push('live ends');

          return { kind: 'unavailable', retryAfterMs: 1 };
        },
      },
      recovery: { intervalMs: null, pull: () => Promise.resolve({ kind: 'expired' }) },
      backfill: {
        intervalMs: null,
        pull: () => {
          events.push('backfill starts');

          return Promise.resolve({ kind: 'unavailable', retryAfterMs: 1 });
        },
      },
    },
  });

  const signal = new AbortController().signal;

  const held = ingest.runPull('almanac', 'live', null, signal);

  await started.promise;

  const waiting = new AbortController();

  const stopped = ingest.runPull('almanac', 'recovery', null, waiting.signal);
  const behind = ingest.runPull('almanac', 'backfill', null, signal);

  waiting.abort();

  await stopped;

  release.resolve();

  await Promise.all([held, behind]);

  expect(events).toStrictEqual(['live ends', 'backfill starts']);
});
