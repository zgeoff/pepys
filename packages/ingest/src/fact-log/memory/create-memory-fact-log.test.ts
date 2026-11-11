import { expect, test } from 'bun:test';
import type { StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { buildTestFact } from '../test-utils/build-test-fact.ts';
import { createMemoryFactLog } from './create-memory-fact-log.ts';

function setupTest() {
  const stream = toTagged<StreamName>('facts.manual.link');
  const log = createMemoryFactLog([stream]);

  return {
    stream,
    log,
    readIDs: async () => {
      const read = await log.read(stream, toTagged<StreamOffset>(0), 100);

      invariant(read.ok);

      return read.value.map((stored): string => stored.fact.id);
    },
  };
}

test('it reports an unknown outcome for an append whose reply is lost', async () => {
  const ctx = setupTest();

  ctx.log.loseNextReply();

  const outcome = await ctx.log.appendBatch(
    ctx.stream,
    [buildTestFact('event:test:a')],
    toTagged<StreamOffset>(0),
  );

  expect(outcome).toStrictEqual({ kind: 'unknown' });
});

test('it stores an append whose reply is lost', async () => {
  const ctx = setupTest();

  ctx.log.loseNextReply();

  await ctx.log.appendBatch(ctx.stream, [buildTestFact('event:test:a')], toTagged<StreamOffset>(0));

  const tail = await ctx.log.readTail(ctx.stream);

  expect(tail).toStrictEqual({ ok: true, value: toTagged<StreamOffset>(1) });
});

test('it rejects a repeat of an append whose reply is lost as a tail mismatch', async () => {
  const ctx = setupTest();

  ctx.log.loseNextReply();

  await ctx.log.appendBatch(ctx.stream, [buildTestFact('event:test:a')], toTagged<StreamOffset>(0));

  const outcome = await ctx.log.appendBatch(
    ctx.stream,
    [buildTestFact('event:test:a')],
    toTagged<StreamOffset>(0),
  );

  expect(outcome).toStrictEqual({ kind: 'rejected', reason: 'tail-mismatch' });
});

test('it loses the reply of one append only', async () => {
  const ctx = setupTest();

  ctx.log.loseNextReply();

  await ctx.log.appendBatch(ctx.stream, [buildTestFact('event:test:a')], toTagged<StreamOffset>(0));

  const outcome = await ctx.log.appendBatch(
    ctx.stream,
    [buildTestFact('event:test:b')],
    toTagged<StreamOffset>(1),
  );

  expect(outcome).toStrictEqual({
    kind: 'acknowledged',
    firstOffset: toTagged<StreamOffset>(1),
    count: 1,
  });
});

test('it drops an append and stores the facts of a second writer at its tail', async () => {
  const ctx = setupTest();

  ctx.log.dropNextAppend({ thenAppend: [buildTestFact('event:test:c')] });

  const outcome = await ctx.log.appendBatch(
    ctx.stream,
    [buildTestFact('event:test:a'), buildTestFact('event:test:b')],
    toTagged<StreamOffset>(0),
  );

  const ids = await ctx.readIDs();

  expect(outcome).toStrictEqual({ kind: 'unknown' });
  expect(ids).toStrictEqual(['event:test:c']);
});

test('it keeps an append that lands late out of the stream until the next append is checked', async () => {
  const ctx = setupTest();

  ctx.log.landNextAppendLate();

  const outcome = await ctx.log.appendBatch(
    ctx.stream,
    [buildTestFact('event:test:a')],
    toTagged<StreamOffset>(0),
  );

  const ids = await ctx.readIDs();

  expect(outcome).toStrictEqual({ kind: 'unknown' });
  expect(ids).toStrictEqual([]);
});

test('it lands a late append whole just before the next append, which gets a tail mismatch', async () => {
  const ctx = setupTest();
  const run = [buildTestFact('event:test:a'), buildTestFact('event:test:b')];

  ctx.log.landNextAppendLate();

  await ctx.log.appendBatch(ctx.stream, run, toTagged<StreamOffset>(0));

  const outcome = await ctx.log.appendBatch(ctx.stream, run, toTagged<StreamOffset>(0));
  const ids = await ctx.readIDs();

  expect(outcome).toStrictEqual({ kind: 'rejected', reason: 'tail-mismatch' });
  expect(ids).toStrictEqual(['event:test:a', 'event:test:b']);
});

test('it stores no fact of an append with a fact that fails the envelope parse', async () => {
  const ctx = setupTest();

  const outcome = await ctx.log.appendBatch(
    ctx.stream,
    [buildTestFact('event:test:a'), buildTestFact('not-a-fact-id')],
    toTagged<StreamOffset>(0),
  );

  const ids = await ctx.readIDs();

  expect(outcome).toStrictEqual({ kind: 'rejected', reason: 'invalid-envelope', index: 1 });
  expect(ids).toStrictEqual([]);
});

test('it keeps a stored fact as appended when the caller changes the envelope afterwards', async () => {
  const ctx = setupTest();
  const payload = { evidence: 'the email quotes the issue title' };

  await ctx.log.appendBatch(
    ctx.stream,
    [buildTestFact('event:test:a', payload)],
    toTagged<StreamOffset>(0),
  );

  payload.evidence = 'rewritten';

  const read = await ctx.log.read(ctx.stream, toTagged<StreamOffset>(0), 1);

  invariant(read.ok);

  expect(read.value[0]?.fact.payload).toStrictEqual({
    evidence: 'the email quotes the issue title',
  });
});

test('it keeps a stored fact as appended when a reader changes what it read', async () => {
  const ctx = setupTest();

  await ctx.log.appendBatch(ctx.stream, [buildTestFact('event:test:a')], toTagged<StreamOffset>(0));

  const first = await ctx.log.read(ctx.stream, toTagged<StreamOffset>(0), 1);

  invariant(first.ok && first.value[0] !== undefined);

  first.value[0].fact.type = 'link.retracted';

  const second = await ctx.log.read(ctx.stream, toTagged<StreamOffset>(0), 1);

  invariant(second.ok);

  expect(second.value[0]?.fact.type).toBe('link.asserted');
});
