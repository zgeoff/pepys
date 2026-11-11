import { expect, mock, test } from 'bun:test';
import { parseFactEnvelope } from '@pepys/kit';
import type { FactID, StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { makeFactAppender } from './make-fact-appender.ts';
import { createMemoryFactLog } from './memory/create-memory-fact-log.ts';
import { buildStubFactLog } from './test-utils/build-stub-fact-log.ts';

test('it appends the fact as one JSON record', async () => {
  const parsed = parseFactEnvelope({
    id: 'webhook:github:d-1',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:77',
    at: '2026-10-02T10:30:00Z',
    payload: {},
  });

  invariant(parsed.ok);

  const fact = parsed.value;
  const log = createMemoryFactLog([toTagged<StreamName>('facts.github.pull_request')]);

  await makeFactAppender({
    log,
    stream: toTagged<StreamName>('facts.github.pull_request'),
    maxAttempts: 3,
    retryDelayMs: 0,
  })(fact);

  const read = await log.read(
    toTagged<StreamName>('facts.github.pull_request'),
    toTagged<StreamOffset>(0),
    10,
  );

  invariant(read.ok);

  expect(read.value.map((stored) => stored.body)).toStrictEqual([JSON.stringify(fact)]);
});

test('it stores one copy of a fact whose stored append lost its reply', async () => {
  const parsed = parseFactEnvelope({
    id: 'webhook:github:d-1',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:77',
    at: '2026-10-02T10:30:00Z',
    payload: {},
  });

  invariant(parsed.ok);

  const fact = parsed.value;
  const log = createMemoryFactLog([toTagged<StreamName>('facts.github.pull_request')]);

  log.loseNextReply();

  await makeFactAppender({
    log,
    stream: toTagged<StreamName>('facts.github.pull_request'),
    maxAttempts: 3,
    retryDelayMs: 0,
  })(fact);

  const read = await log.read(
    toTagged<StreamName>('facts.github.pull_request'),
    toTagged<StreamOffset>(0),
    10,
  );

  invariant(read.ok);

  expect(read.value.map((stored) => stored.body)).toStrictEqual([JSON.stringify(fact)]);
});

test('it appends the fact again after an append whose outcome is unknown and that stored nothing', async () => {
  const parsed = parseFactEnvelope({
    id: 'webhook:github:d-1',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:77',
    at: '2026-10-02T10:30:00Z',
    payload: {},
  });

  invariant(parsed.ok);

  const fact = parsed.value;
  const memoryLog = createMemoryFactLog([toTagged<StreamName>('facts.github.pull_request')]);
  const append = mock(memoryLog.append).mockResolvedValueOnce({ kind: 'unknown' });

  await makeFactAppender({
    log: { ...memoryLog, append },
    stream: toTagged<StreamName>('facts.github.pull_request'),
    maxAttempts: 3,
    retryDelayMs: 0,
  })(fact);

  const read = await memoryLog.read(
    toTagged<StreamName>('facts.github.pull_request'),
    toTagged<StreamOffset>(0),
    10,
  );

  invariant(read.ok);

  expect(read.value.map((stored) => stored.body)).toStrictEqual([JSON.stringify(fact)]);
});

test('it stores each of two facts appended at once to one stream', async () => {
  const first = parseFactEnvelope({
    id: 'webhook:github:d-1',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:77',
    at: '2026-10-02T10:30:00Z',
    payload: {},
  });

  const second = parseFactEnvelope({
    id: 'webhook:github:d-2',
    type: 'github.pull_request.closed',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:77',
    at: '2026-10-02T10:31:00Z',
    payload: {},
  });

  invariant(first.ok);
  invariant(second.ok);

  const log = createMemoryFactLog([toTagged<StreamName>('facts.github.pull_request')]);

  const append = makeFactAppender({
    log,
    stream: toTagged<StreamName>('facts.github.pull_request'),
    maxAttempts: 1,
    retryDelayMs: 0,
  });

  await Promise.all([append(first.value), append(second.value)]);

  const read = await log.read(
    toTagged<StreamName>('facts.github.pull_request'),
    toTagged<StreamOffset>(0),
    10,
  );

  invariant(read.ok);

  expect(read.value.map((stored) => stored.fact.id)).toStrictEqual([
    toTagged<FactID>('webhook:github:d-1'),
    toTagged<FactID>('webhook:github:d-2'),
  ]);
});

test('it appends a fact after an earlier append to the stream failed', async () => {
  const parsed = parseFactEnvelope({
    id: 'webhook:github:d-2',
    type: 'github.pull_request.closed',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:77',
    at: '2026-10-02T10:31:00Z',
    payload: {},
  });

  invariant(parsed.ok);

  const log = createMemoryFactLog([toTagged<StreamName>('facts.github.pull_request')]);

  const append = makeFactAppender({
    log,
    stream: toTagged<StreamName>('facts.github.pull_request'),
    maxAttempts: 1,
    retryDelayMs: 0,
  });

  await Promise.allSettled([
    append({ ...parsed.value, id: toTagged<FactID>('not-a-fact-id') }),
    append(parsed.value),
  ]);

  const read = await log.read(
    toTagged<StreamName>('facts.github.pull_request'),
    toTagged<StreamOffset>(0),
    10,
  );

  invariant(read.ok);

  expect(read.value.map((stored) => stored.fact.id)).toStrictEqual([
    toTagged<FactID>('webhook:github:d-2'),
  ]);
});

test('it fails once the attempts are used up', () => {
  const parsed = parseFactEnvelope({
    id: 'webhook:github:d-1',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:77',
    at: '2026-10-02T10:30:00Z',
    payload: {},
  });

  invariant(parsed.ok);

  const log = buildStubFactLog({ kind: 'unknown' });

  const append = makeFactAppender({
    log,
    stream: toTagged<StreamName>('facts.github.pull_request'),
    maxAttempts: 3,
    retryDelayMs: 0,
  });

  expect(append(parsed.value)).rejects.toThrow('no acknowledged append after 3 attempts');
});

test('it appends again after an append rejected for a tail mismatch', async () => {
  const parsed = parseFactEnvelope({
    id: 'webhook:github:d-1',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:77',
    at: '2026-10-02T10:30:00Z',
    payload: {},
  });

  invariant(parsed.ok);

  const log = buildStubFactLog({ kind: 'rejected', reason: 'tail-mismatch' });

  await makeFactAppender({
    log,
    stream: toTagged<StreamName>('facts.github.pull_request'),
    maxAttempts: 3,
    retryDelayMs: 0,
  })(parsed.value).catch(() => null);

  expect(log.append).toHaveBeenCalledTimes(3);
});

test('it does not retry a refusal from the log', async () => {
  const parsed = parseFactEnvelope({
    id: 'webhook:github:d-1',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:77',
    at: '2026-10-02T10:30:00Z',
    payload: {},
  });

  invariant(parsed.ok);

  const log = buildStubFactLog({ kind: 'rejected', reason: 'invalid-envelope' });

  await makeFactAppender({
    log,
    stream: toTagged<StreamName>('facts.github.pull_request'),
    maxAttempts: 3,
    retryDelayMs: 0,
  })(parsed.value).catch(() => null);

  expect(log.append).toHaveBeenCalledTimes(1);
});

test('it fails with the error of an append the log throws, without a retry', () => {
  const parsed = parseFactEnvelope({
    id: 'webhook:github:d-1',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:77',
    at: '2026-10-02T10:30:00Z',
    payload: {},
  });

  invariant(parsed.ok);

  const memoryLog = createMemoryFactLog([toTagged<StreamName>('facts.github.pull_request')]);
  const append = mock(memoryLog.append).mockRejectedValueOnce(new Error('the token cannot append'));

  const appended = makeFactAppender({
    log: { ...memoryLog, append },
    stream: toTagged<StreamName>('facts.github.pull_request'),
    maxAttempts: 3,
    retryDelayMs: 0,
  })(parsed.value);

  expect(appended).rejects.toThrow('the token cannot append');
});

test('it appends the fact after a tail read that failed', async () => {
  const parsed = parseFactEnvelope({
    id: 'webhook:github:d-1',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pull_request:77',
    at: '2026-10-02T10:30:00Z',
    payload: {},
  });

  invariant(parsed.ok);

  const memoryLog = createMemoryFactLog([toTagged<StreamName>('facts.github.pull_request')]);
  const readTail = mock(memoryLog.readTail).mockRejectedValueOnce(new Error('connection reset'));

  await makeFactAppender({
    log: { ...memoryLog, readTail },
    stream: toTagged<StreamName>('facts.github.pull_request'),
    maxAttempts: 3,
    retryDelayMs: 0,
  })(parsed.value);

  const read = await memoryLog.read(
    toTagged<StreamName>('facts.github.pull_request'),
    toTagged<StreamOffset>(0),
    10,
  );

  invariant(read.ok);

  expect(read.value.map((stored) => stored.body)).toStrictEqual([JSON.stringify(parsed.value)]);
});
