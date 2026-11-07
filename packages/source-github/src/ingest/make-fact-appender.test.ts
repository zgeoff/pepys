import { expect, test } from 'bun:test';
import { createMemoryFactLog } from '@pepys/ingest';
import { parseFactEnvelope } from '@pepys/schema';
import type { StreamName, StreamOffset } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { buildStubFactLog } from '../test-utils/build-stub-fact-log.ts';
import { makeFactAppender } from './make-fact-appender.ts';

test('it appends the fact as one JSON record', async () => {
  const parsed = parseFactEnvelope({
    id: 'webhook:github:d-1',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pr:77',
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

test('it appends the fact again after an append whose outcome is unknown', async () => {
  const parsed = parseFactEnvelope({
    id: 'webhook:github:d-1',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pr:77',
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

  expect(read.value.map((stored) => stored.body)).toStrictEqual([
    JSON.stringify(fact),
    JSON.stringify(fact),
  ]);
});

test('it fails once the attempts are used up', () => {
  const parsed = parseFactEnvelope({
    id: 'webhook:github:d-1',
    type: 'github.pull_request.opened',
    v: 1,
    api: 'github/2022-11-28',
    entity: 'github:pr:77',
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
    entity: 'github:pr:77',
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
    entity: 'github:pr:77',
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
