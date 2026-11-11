import { expect, test } from 'bun:test';
import { createMemoryFactLog } from '@pepys/ingest';
import type { EntityID, FactID, StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { createStubWaitingOnMe } from './create-stub-waiting-on-me.ts';

function setupTest() {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.github.pull_request')]);

  const waitingOnMe = createStubWaitingOnMe({
    log,
    stream: toTagged<StreamName>('facts.github.pull_request'),
    owner: toTagged<EntityID>('github:user:4401'),
  });

  return { log, waitingOnMe };
}

test("it serves a change message for a review request of the owner's", async () => {
  const ctx = setupTest();

  await ctx.log.appendBatch(
    toTagged<StreamName>('facts.github.pull_request'),
    [
      {
        id: toTagged<FactID>('webhook:github:delivery-7'),
        type: 'pull_request.review_requested',
        v: 1,
        api: 'github/2022-11-28',
        entity: toTagged<EntityID>('github:pull_request:12'),
        at: '2026-10-01T08:00:00Z',
        payload: {
          action: 'review_requested',
          pull_request: { id: 12, title: 'Add the harbour map and tides' },
          requested_reviewer: { id: 4401 },
        },
      },
    ],
    toTagged<StreamOffset>(0),
  );

  await ctx.waitingOnMe.apply();

  const read = await ctx.waitingOnMe.feed.read(
    { consumer: 'waiting_on_me', generation: 1 },
    -1,
    'catch-up',
  );

  expect(read).toStrictEqual({
    kind: 'messages',
    messages: [
      {
        kind: 'change',
        type: 'waiting_on_me',
        key: 'github:pull_request:12',
        value: {
          id: toTagged<EntityID>('github:pull_request:12'),
          reason: 'review-requested',
          since: '2026-10-01T08:00:00Z',
        },
        oldValue: null,
        operation: 'insert',
      },
    ],
    next: toTagged<StreamOffset>(1),
    atTail: true,
  });
});

test('it serves no change message for a review request of someone else', async () => {
  const ctx = setupTest();

  await ctx.log.appendBatch(
    toTagged<StreamName>('facts.github.pull_request'),
    [
      {
        id: toTagged<FactID>('webhook:github:delivery-8'),
        type: 'pull_request.review_requested',
        v: 1,
        api: 'github/2022-11-28',
        entity: toTagged<EntityID>('github:pull_request:13'),
        at: '2026-10-01T08:00:00Z',
        payload: {
          action: 'review_requested',
          pull_request: { id: 13, title: 'Mark the reefs' },
          requested_reviewer: { id: 5150 },
        },
      },
    ],
    toTagged<StreamOffset>(0),
  );

  await ctx.waitingOnMe.apply();

  const read = await ctx.waitingOnMe.feed.read(
    { consumer: 'waiting_on_me', generation: 1 },
    -1,
    'catch-up',
  );

  expect(read).toStrictEqual({
    kind: 'messages',
    messages: [],
    next: toTagged<StreamOffset>(0),
    atTail: true,
  });
});
