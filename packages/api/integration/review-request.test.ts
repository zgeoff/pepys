import { expect, test } from 'bun:test';
import { createMemoryFactLog } from '@pepys/ingest';
import type { EntityID, StreamName, StreamOffset } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { buildStubGitHubWebhook } from '../src/test-utils/build-stub-github-webhook.ts';
import { createStubWaitingOnMe } from '../src/test-utils/create-stub-waiting-on-me.ts';

function setupTest() {
  const log = createMemoryFactLog([toTagged<StreamName>('facts.github.pull_request')]);

  const webhook = buildStubGitHubWebhook({
    secret: 'harbour-webhook-secret',
    stream: toTagged<StreamName>('facts.github.pull_request'),
  });

  const waitingOnMe = createStubWaitingOnMe({
    log,
    stream: toTagged<StreamName>('facts.github.pull_request'),
    owner: toTagged<EntityID>('github:user:4401'),
  });

  return { log, webhook, waitingOnMe };
}

test('it carries a signed review request from the webhook to a waiting-on-me row and its change message', async () => {
  const ctx = setupTest();

  const received = await ctx.webhook.receive(
    new Request('http://pepys.test/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-delivery': 'delivery-7',
        'x-hub-signature-256':
          'sha256=ec1e713bc814a55312bbd566139d9cc02fe90349bd00597a95ef32946af1bd7c',
      },
      body: '{"action":"review_requested","pull_request":{"id":12,"title":"Add the harbour map and tides"},"requested_reviewer":{"id":4401}}',
    }),
  );

  invariant(received.kind === 'batch', 'the webhook accepts a signed request');

  const appended = await Promise.all(
    received.batch.facts.map((pending, index) =>
      ctx.log.append(pending.stream, pending.fact, toTagged<StreamOffset>(index)),
    ),
  );

  invariant(
    appended.every((outcome) => outcome.kind === 'acknowledged'),
    'the memory log acknowledges each append',
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
        key: 'github:pr:12',
        value: {
          id: toTagged<EntityID>('github:pr:12'),
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
