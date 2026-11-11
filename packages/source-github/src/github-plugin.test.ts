import { expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { createIngest, createMemoryFactLog, noSenderProof } from '@pepys/ingest';
import { checkDeployment, defineDeployment } from '@pepys/kit';
import type { StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { githubPlugin } from './github-plugin.ts';

function setupTest() {
  const stream = toTagged<StreamName>('facts.github.pull_request');
  const log = createMemoryFactLog([stream]);
  const deployment = checkDeployment(defineDeployment({ name: 'github', plugins: [githubPlugin] }));

  invariant(deployment.ok, 'the GitHub deployment passes the check');

  const ingest = createIngest({
    deployment: deployment.value,
    secrets: { PEPYS_GITHUB_WEBHOOK_SECRET: 'harbour-webhook-secret' },
    log,
    senderProof: noSenderProof,
    appendRetry: { maxAttempts: 2, retryDelayMs: 0 },
    now: () => 0,
  });

  return {
    send: (body: string, signature: string) =>
      ingest.handleRequest(
        new Request('http://ingest.test/webhook', {
          method: 'POST',
          headers: {
            'x-hub-signature-256': signature,
            'x-github-event': 'pull_request',
            'x-github-delivery': 'd-7',
          },
          body,
        }),
      ),
    sign: (secret: string, body: string) =>
      `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
    readIDs: async () => {
      const read = await log.read(stream, toTagged<StreamOffset>(0), 10);

      invariant(read.ok, 'the stream exists');

      return read.value.map((stored): string => stored.fact.id);
    },
  };
}

test('it stores a signed pull request webhook through the receive route', async () => {
  const ctx = setupTest();

  const body = JSON.stringify({
    action: 'opened',
    pull_request: { id: 77, updated_at: '2026-10-02T10:30:00Z' },
  });

  const response = await ctx.send(body, ctx.sign('harbour-webhook-secret', body));

  const answer = { status: response.status, body: await response.json() };

  const ids = await ctx.readIDs();

  expect({ answer, ids }).toStrictEqual({
    answer: { status: 200, body: { status: 'stored', stored: 1 } },
    ids: ['webhook:github:d-7'],
  });
});

test('it refuses a webhook signed with another secret and stores nothing', async () => {
  const ctx = setupTest();

  const body = JSON.stringify({
    action: 'opened',
    pull_request: { id: 77, updated_at: '2026-10-02T10:30:00Z' },
  });

  const response = await ctx.send(body, ctx.sign('some-other-secret', body));
  const ids = await ctx.readIDs();

  expect({ status: response.status, ids }).toStrictEqual({ status: 401, ids: [] });
});
