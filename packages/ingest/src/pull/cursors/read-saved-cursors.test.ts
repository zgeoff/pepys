import { expect, test } from 'bun:test';
import type { StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { createMemoryFactLog } from '../../fact-log/memory/create-memory-fact-log.ts';
import type { TimedPull } from '../collect-timed-pulls.ts';
import { buildCursorRecord } from './build-cursor-record.ts';
import { cursorStream } from './cursor-stream.ts';
import { readSavedCursors } from './read-saved-cursors.ts';

function setupTest() {
  const log = createMemoryFactLog([cursorStream]);

  return {
    log,
    readSavedCursors: (pulls: readonly TimedPull[]) => readSavedCursors(log, pulls),
  };
}

test('it gives a pull the cursor of its newest record, and null to a pull with no record', async () => {
  const ctx = setupTest();

  await ctx.log.appendBatch(
    cursorStream,
    [
      buildCursorRecord({ source: 'almanac', path: 'live', cursor: 'tide-40', nowMs: 0 }),
      buildCursorRecord({ source: 'almanac', path: 'recovery', cursor: 'gap-7', nowMs: 0 }),
      buildCursorRecord({ source: 'almanac', path: 'live', cursor: 'tide-41', nowMs: 0 }),
      buildCursorRecord({ source: 'tally', path: 'live', cursor: 'sheet-3', nowMs: 0 }),
    ],
    toTagged<StreamOffset>(0),
  );

  const pulls = await ctx.readSavedCursors([
    { source: 'almanac', path: 'live', intervalMs: 60_000 },
    { source: 'almanac', path: 'backfill', intervalMs: 60_000 },
  ]);

  expect(pulls).toStrictEqual([
    { source: 'almanac', path: 'live', intervalMs: 60_000, cursor: 'tide-41' },
    { source: 'almanac', path: 'backfill', intervalMs: 60_000, cursor: null },
  ]);
});

test('it finds a record that lies more than one page before the tail', async () => {
  const ctx = setupTest();

  await ctx.log.appendBatch(
    cursorStream,
    [buildCursorRecord({ source: 'almanac', path: 'recovery', cursor: 'gap-7', nowMs: 0 })],
    toTagged<StreamOffset>(0),
  );

  await ctx.log.appendBatch(
    cursorStream,
    Array.from({ length: 1000 }, (_, index) =>
      buildCursorRecord({ source: 'almanac', path: 'live', cursor: `tide-${index}`, nowMs: 0 }),
    ),
    toTagged<StreamOffset>(1),
  );

  await ctx.log.appendBatch(
    cursorStream,
    Array.from({ length: 500 }, (_, index) =>
      buildCursorRecord({
        source: 'almanac',
        path: 'live',
        cursor: `tide-${1000 + index}`,
        nowMs: 0,
      }),
    ),
    toTagged<StreamOffset>(1001),
  );

  const pulls = await ctx.readSavedCursors([
    { source: 'almanac', path: 'live', intervalMs: 60_000 },
    { source: 'almanac', path: 'recovery', intervalMs: 3_600_000 },
  ]);

  expect(pulls).toStrictEqual([
    { source: 'almanac', path: 'live', intervalMs: 60_000, cursor: 'tide-1499' },
    { source: 'almanac', path: 'recovery', intervalMs: 3_600_000, cursor: 'gap-7' },
  ]);
});

test('it gives every pull null on an empty cursor stream', async () => {
  const ctx = setupTest();

  const pulls = await ctx.readSavedCursors([{ source: 'almanac', path: 'live', intervalMs: 5 }]);

  expect(pulls).toStrictEqual([{ source: 'almanac', path: 'live', intervalMs: 5, cursor: null }]);
});
