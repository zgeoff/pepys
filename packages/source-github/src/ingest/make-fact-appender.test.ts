import { expect, test } from 'bun:test';
import { parseFactEnvelope } from '@pepys/schema';
import { S2Error } from '@s2-dev/streamstore';
import type { AppendInput } from '@s2-dev/streamstore';
import invariant from 'tiny-invariant';
import { makeFactAppender } from './make-fact-appender.ts';

// The stand-in stream keeps the records it stores, and fails the calls the test lists.
function setupTest(outcomes: ('stored' | 'lost-ack' | 'refused' | 'unavailable')[]) {
  const stored: string[] = [];
  const calls: number[] = [];

  const stream = {
    append: (input: AppendInput): Promise<unknown> => {
      calls.push(calls.length);

      const outcome = outcomes[calls.length - 1] ?? 'stored';

      if (outcome === 'unavailable') {
        return Promise.reject(
          new S2Error({ message: 'unavailable', status: 503, origin: 'server' }),
        );
      }

      if (outcome === 'refused') {
        return Promise.reject(
          new S2Error({ message: 'invalid record', status: 400, origin: 'server' }),
        );
      }

      stored.push(...input.records.map((record) => String(record.body)));

      if (outcome === 'lost-ack') {
        return Promise.reject(
          new S2Error({ message: 'connection reset', status: 0, origin: 'sdk' }),
        );
      }

      return Promise.resolve({ start: { seqNum: stored.length - 1 } });
    },
  };

  return { stored, calls, stream };
}

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
  const ctx = setupTest(['stored']);

  await makeFactAppender({ stream: ctx.stream, maxAttempts: 3, retryDelayMs: 0 })(fact);

  expect(ctx.stored).toStrictEqual([JSON.stringify(fact)]);
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
  const ctx = setupTest(['lost-ack', 'stored']);

  await makeFactAppender({ stream: ctx.stream, maxAttempts: 3, retryDelayMs: 0 })(fact);

  expect(ctx.stored).toStrictEqual([JSON.stringify(fact), JSON.stringify(fact)]);
});

test('it retries a server that is unavailable until an append is stored', async () => {
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
  const ctx = setupTest(['unavailable', 'unavailable', 'stored']);

  await makeFactAppender({ stream: ctx.stream, maxAttempts: 3, retryDelayMs: 0 })(fact);

  expect({ calls: ctx.calls.length, stored: ctx.stored }).toStrictEqual({
    calls: 3,
    stored: [JSON.stringify(fact)],
  });
});

test('it fails once the attempts are used up', async () => {
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
  const ctx = setupTest(['unavailable', 'unavailable', 'unavailable', 'stored']);
  const append = makeFactAppender({ stream: ctx.stream, maxAttempts: 3, retryDelayMs: 0 });
  let error: unknown = null;

  try {
    await append(fact);
  } catch (error_: unknown) {
    error = error_;
  }

  expect(error).toStrictEqual(
    expect.objectContaining({ message: expect.stringContaining('unavailable') }),
  );

  expect(ctx.calls).toHaveLength(3);
});

test('it does not retry a refusal from the server', async () => {
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
  const ctx = setupTest(['refused', 'stored']);
  const append = makeFactAppender({ stream: ctx.stream, maxAttempts: 3, retryDelayMs: 0 });
  let error: unknown = null;

  try {
    await append(fact);
  } catch (error_: unknown) {
    error = error_;
  }

  expect(error).toStrictEqual(
    expect.objectContaining({ message: expect.stringContaining('invalid record') }),
  );

  expect(ctx.calls).toHaveLength(1);
});
