import { expect, test } from 'bun:test';
import { createHmac, generateKeyPairSync } from 'node:crypto';
import { createIngest, createMemoryFactLog, noSenderProof } from '@pepys/ingest';
import { checkDeployment, createLogger, defineDeployment } from '@pepys/kit';
import type { StreamName, StreamOffset } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { githubPlugin } from './github-plugin.ts';
import { githubSource } from './github-source.ts';

function setupTest() {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const streams = githubSource.families.map((family) => toTagged<StreamName>(family.stream));
  const log = createMemoryFactLog(streams);

  const deployment = checkDeployment(
    defineDeployment({ name: 'harbour', plugins: [githubPlugin] }),
  );

  invariant(deployment.ok, 'the GitHub deployment passes the check');

  const ingest = createIngest({
    deployment: deployment.value,
    secrets: {
      PEPYS_GITHUB_WEBHOOK_SECRET: 'harbour-webhook-secret',
      PEPYS_GITHUB_APP_ID: '4242',
      PEPYS_GITHUB_APP_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs1', format: 'pem' }),
    },
    log,
    senderProof: noSenderProof,
    appendRetry: { maxAttempts: 2, retryDelayMs: 0 },
    now: () => 0,
    logger: createLogger({ write: () => {} }),
  });

  return {
    send: (event: string, deliveryID: string, body: string) =>
      ingest.handleRequest(
        new Request('http://ingest.test/webhook/github', {
          method: 'POST',
          headers: {
            'x-hub-signature-256': `sha256=${createHmac('sha256', 'harbour-webhook-secret').update(body).digest('hex')}`,
            'x-github-event': event,
            'x-github-delivery': deliveryID,
          },
          body,
        }),
      ),
    readFacts: async (stream: string) => {
      const read = await log.read(toTagged<StreamName>(stream), toTagged<StreamOffset>(0), 100);

      invariant(read.ok, 'the stream exists');

      return read.value.map((item): unknown => item.fact);
    },
  };
}

test.each([
  {
    event: 'pull_request_review_comment',
    body: {
      action: 'created',
      comment: {
        id: 5101,
        body: 'Could the tide table take the harbour offset too?',
        created_at: '2026-10-03T08:15:00Z',
        updated_at: '2026-10-03T08:15:00Z',
      },
      pull_request: { id: 77, updated_at: '2026-10-03T08:15:00Z' },
      sender: { id: 4401 },
    },
    fact: {
      stream: 'facts.github.review_comment',
      type: 'github.review_comment.created',
      entity: 'github:review_comment:5101',
      actor: 'github:user:4401',
      at: '2026-10-03T08:15:00Z',
    },
  },
  {
    event: 'pull_request_review_thread',
    body: {
      action: 'resolved',
      thread: {
        node_id: 'PRRT_harbour1',
        comments: [
          { id: 5101, body: 'Could the tide table take the harbour offset too?' },
          { id: 5102, in_reply_to_id: 5101, body: 'Done in the next commit.' },
        ],
      },
      updated_at: '2026-10-03T09:40:00Z',
      pull_request: { id: 77, updated_at: '2026-10-03T09:00:00Z' },
      sender: { id: 4402 },
    },
    fact: {
      stream: 'facts.github.review_thread',
      type: 'github.review_thread.resolved',
      entity: 'github:review_thread:5101',
      actor: 'github:user:4402',
      at: '2026-10-03T09:40:00Z',
    },
  },
  {
    event: 'pull_request_review_thread',
    body: {
      action: 'unresolved',
      thread: {
        node_id: 'PRRT_harbour2',
        comments: [{ id: 5104, in_reply_to_id: 5103, body: 'The buoy list still misses one.' }],
      },
      updated_at: null,
      pull_request: { id: 77, updated_at: '2026-10-03T10:10:00Z' },
      sender: { id: 4402 },
    },
    fact: {
      stream: 'facts.github.review_thread',
      type: 'github.review_thread.unresolved',
      entity: 'github:review_thread:5103',
      actor: 'github:user:4402',
      at: '2026-10-03T10:10:00Z',
    },
  },
  {
    event: 'issue_comment',
    body: {
      action: 'edited',
      comment: {
        id: 6201,
        body: 'The lighthouse log shows the same gap on Tuesday.',
        created_at: '2026-10-04T11:00:00Z',
        updated_at: '2026-10-04T11:20:00Z',
      },
      issue: { id: 71, number: 12 },
      sender: { id: 4403 },
    },
    fact: {
      stream: 'facts.github.issue_comment',
      type: 'github.issue_comment.edited',
      entity: 'github:issue_comment:6201',
      actor: 'github:user:4403',
      at: '2026-10-04T11:20:00Z',
    },
  },
  {
    event: 'repository',
    body: {
      action: 'renamed',
      changes: { repository: { name: { from: 'harbour' } } },
      repository: {
        id: 902,
        full_name: 'acme/breakwater',
        created_at: '2026-01-05T10:00:00Z',
        updated_at: '2026-10-05T14:00:00Z',
        pushed_at: '2026-10-05T13:00:00Z',
      },
      sender: { id: 4404 },
    },
    fact: {
      stream: 'facts.github.repository',
      type: 'github.repository.renamed',
      entity: 'github:repo:902',
      actor: 'github:user:4404',
      at: '2026-10-05T14:00:00Z',
    },
  },
])('it stores one $fact.type fact for a signed $event webhook sent twice', async (row) => {
  const ctx = setupTest();
  const body = JSON.stringify(row.body);

  await ctx.send(row.event, 'd-1', body);
  await ctx.send(row.event, 'd-2', body);

  const stored = await ctx.readFacts(row.fact.stream);

  expect(stored).toStrictEqual([
    {
      id: expect.stringMatching(/^webhook:github:h-[0-9a-f]{64}$/u),
      type: row.fact.type,
      v: 1,
      api: 'github/2022-11-28',
      entity: row.fact.entity,
      actor: row.fact.actor,
      at: row.fact.at,
      payload: row.body,
    },
  ]);
});

test.each([
  {
    row: 'a review thread with no comments',
    event: 'pull_request_review_thread',
    body: {
      action: 'resolved',
      thread: { comments: [] },
      pull_request: { updated_at: '2026-10-03T09:00:00Z' },
    },
  },
  {
    row: 'a repository delivery with no time',
    event: 'repository',
    body: { action: 'edited', repository: { id: 902, created_at: null, updated_at: null } },
  },
])('it answers 422 to $row', async (row) => {
  const ctx = setupTest();

  const response = await ctx.send(row.event, 'd-1', JSON.stringify(row.body));

  expect(response.status).toBe(422);
});
