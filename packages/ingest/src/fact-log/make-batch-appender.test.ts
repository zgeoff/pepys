import { expect, mock, test } from 'bun:test';
import type { StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { makeBatchAppender } from './make-batch-appender.ts';
import { createMemoryFactLog } from './memory/create-memory-fact-log.ts';
import { buildStubFactLog } from './test-utils/build-stub-fact-log.ts';
import { buildTestFact } from './test-utils/build-test-fact.ts';

function setupTest() {
  const stream = toTagged<StreamName>('facts.github.pull_request');
  const log = createMemoryFactLog([stream]);

  return {
    stream,
    log,
    append: makeBatchAppender({ log, maxAttempts: 3, retryDelayMs: 0 }),
    readIDs: async () => {
      const read = await log.read(stream, toTagged<StreamOffset>(0), 100);

      invariant(read.ok);

      return read.value.map((stored): string => stored.fact.id);
    },
  };
}

test('it stores a list of facts in one append', async () => {
  const ctx = setupTest();

  const stored = await ctx.append(ctx.stream, [
    buildTestFact('event:test:1'),
    buildTestFact('event:test:2'),
    buildTestFact('event:test:3'),
  ]);

  const ids = await ctx.readIDs();

  expect(stored).toStrictEqual({
    ok: true,
    value: { firstOffset: toTagged<StreamOffset>(0), count: 3 },
  });

  expect(ids).toStrictEqual(['event:test:1', 'event:test:2', 'event:test:3']);
});

test('it stores the run once when the reply of its append is lost', async () => {
  const ctx = setupTest();

  await ctx.append(ctx.stream, [buildTestFact('event:test:other')]);

  ctx.log.loseNextReply();

  const stored = await ctx.append(ctx.stream, [
    buildTestFact('event:test:1'),
    buildTestFact('event:test:2'),
  ]);

  const ids = await ctx.readIDs();

  expect(stored).toStrictEqual({
    ok: true,
    value: { firstOffset: toTagged<StreamOffset>(1), count: 2 },
  });

  expect(ids).toStrictEqual(['event:test:other', 'event:test:1', 'event:test:2']);
});

test('it stores the whole run again when a second writer took the offset it aimed at with its first fact', async () => {
  const ctx = setupTest();

  ctx.log.dropNextAppend({ thenAppend: [buildTestFact('event:test:1')] });

  const stored = await ctx.append(ctx.stream, [
    buildTestFact('event:test:1'),
    buildTestFact('event:test:2'),
  ]);

  const ids = await ctx.readIDs();

  expect(stored).toStrictEqual({
    ok: true,
    value: { firstOffset: toTagged<StreamOffset>(1), count: 2 },
  });

  expect(ids).toStrictEqual(['event:test:1', 'event:test:1', 'event:test:2']);
});

test('it stores the whole run when a second writer took the offset it aimed at with another fact', async () => {
  const ctx = setupTest();

  ctx.log.dropNextAppend({ thenAppend: [buildTestFact('event:test:other')] });

  const stored = await ctx.append(ctx.stream, [
    buildTestFact('event:test:1'),
    buildTestFact('event:test:2'),
  ]);

  const ids = await ctx.readIDs();

  expect(stored).toStrictEqual({
    ok: true,
    value: { firstOffset: toTagged<StreamOffset>(1), count: 2 },
  });

  expect(ids).toStrictEqual(['event:test:other', 'event:test:1', 'event:test:2']);
});

test('it stores the run once when its first attempt lands after the second is sent', async () => {
  const ctx = setupTest();

  await ctx.append(ctx.stream, [buildTestFact('event:test:other')]);

  ctx.log.landNextAppendLate();

  const stored = await makeBatchAppender({
    log: ctx.log,
    maxAttempts: 2,
    retryDelayMs: 0,
  })(ctx.stream, [buildTestFact('event:test:1'), buildTestFact('event:test:2')]);

  const ids = await ctx.readIDs();

  expect(stored).toStrictEqual({
    ok: true,
    value: { firstOffset: toTagged<StreamOffset>(1), count: 2 },
  });

  expect(ids).toStrictEqual(['event:test:other', 'event:test:1', 'event:test:2']);
});

test('it appends at the new tail after a second writer moved the tail', async () => {
  const ctx = setupTest();
  const readTail = mock(ctx.log.readTail);

  readTail.mockImplementationOnce(async (name) => {
    const tail = await ctx.log.readTail(name);

    await ctx.log.appendBatch(name, [buildTestFact('event:test:other')], toTagged<StreamOffset>(0));

    return tail;
  });

  const stored = await makeBatchAppender({
    log: { ...ctx.log, readTail },
    maxAttempts: 3,
    retryDelayMs: 0,
  })(ctx.stream, [buildTestFact('event:test:1')]);

  const ids = await ctx.readIDs();

  expect(stored).toStrictEqual({
    ok: true,
    value: { firstOffset: toTagged<StreamOffset>(1), count: 1 },
  });

  expect(ids).toStrictEqual(['event:test:other', 'event:test:1']);
});

test('it appends after a tail read that failed', async () => {
  const ctx = setupTest();
  const readTail = mock(ctx.log.readTail).mockRejectedValueOnce(new Error('connection reset'));

  const stored = await makeBatchAppender({
    log: { ...ctx.log, readTail },
    maxAttempts: 3,
    retryDelayMs: 0,
  })(ctx.stream, [buildTestFact('event:test:1')]);

  expect(stored).toStrictEqual({
    ok: true,
    value: { firstOffset: toTagged<StreamOffset>(0), count: 1 },
  });
});

test('it reports not-stored once the attempts are used up on unknown outcomes', async () => {
  const ctx = setupTest();
  const log = buildStubFactLog({ kind: 'unknown' });

  const stored = await makeBatchAppender({ log, maxAttempts: 3, retryDelayMs: 0 })(ctx.stream, [
    buildTestFact('event:test:1'),
  ]);

  expect(stored).toStrictEqual({ ok: false, failure: { kind: 'not-stored', attempts: 3 } });
  expect(log.appendBatch).toHaveBeenCalledTimes(3);
});

test('it appends again after each tail mismatch until the attempts are used up', async () => {
  const ctx = setupTest();
  const log = buildStubFactLog({ kind: 'rejected', reason: 'tail-mismatch' });

  const stored = await makeBatchAppender({ log, maxAttempts: 3, retryDelayMs: 0 })(ctx.stream, [
    buildTestFact('event:test:1'),
  ]);

  expect(stored).toStrictEqual({ ok: false, failure: { kind: 'not-stored', attempts: 3 } });
  expect(log.appendBatch).toHaveBeenCalledTimes(3);
});

test.each([
  ['unknown-stream', { kind: 'rejected', reason: 'unknown-stream' }],
  ['too-large', { kind: 'rejected', reason: 'too-large' }],
  ['invalid-envelope', { kind: 'rejected', reason: 'invalid-envelope', index: 0 }],
] as const)('it refuses a %s rejection without a retry', async (reason, outcome) => {
  const ctx = setupTest();
  const log = buildStubFactLog(outcome);

  const stored = await makeBatchAppender({ log, maxAttempts: 3, retryDelayMs: 0 })(ctx.stream, [
    buildTestFact('event:test:1'),
  ]);

  expect(stored).toStrictEqual({ ok: false, failure: { kind: 'refused', reason } });
  expect(log.appendBatch).toHaveBeenCalledTimes(1);
});

test('it refuses a stream whose tail the log cannot find', async () => {
  const ctx = setupTest();

  const stored = await ctx.append(toTagged<StreamName>('facts.github.missing'), [
    buildTestFact('event:test:1'),
  ]);

  expect(stored).toStrictEqual({
    ok: false,
    failure: { kind: 'refused', reason: 'unknown-stream' },
  });
});

test('it fails with the error of an append the log throws, without a retry', () => {
  const ctx = setupTest();

  const appendBatch = mock(ctx.log.appendBatch).mockRejectedValueOnce(
    new Error('the token cannot append'),
  );

  const stored = makeBatchAppender({
    log: { ...ctx.log, appendBatch },
    maxAttempts: 3,
    retryDelayMs: 0,
  })(ctx.stream, [buildTestFact('event:test:1')]);

  expect(stored).rejects.toThrow('the token cannot append');
});
