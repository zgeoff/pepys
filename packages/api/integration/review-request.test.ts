import { expect, test } from 'bun:test';
import { createMemoryFactLog } from '@pepys/ingest';
import type { ReceivePath } from '@pepys/ingest';
import { buildWebhookFactID, isEntityOfKind } from '@pepys/schema';
import type {
  ConsumerOutcome,
  ConsumerReads,
  EntityID,
  FactInput,
  FactOperation,
  LinkRegistryOf,
  LinkTypeDeclaration,
  ScopeID,
  ScopeInput,
  ScopeOperation,
  StreamName,
  StreamOffset,
} from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { z } from 'zod';
import type { ChangeFeed } from '../src/change-feed/change-feed.ts';

function setupTest() {
  type Registry = LinkRegistryOf<
    LinkTypeDeclaration<'review_requested', 'github:pr', 'github:user'>
  >;

  interface PullRequestRow {
    id: EntityID;
    title: string;
    reviewer: EntityID;
  }

  interface WaitingRow {
    id: EntityID;
    reason: 'review-requested' | 'assigned' | 'needs-reply';
    since: string;
  }

  const secret = 'harbour-webhook-secret';
  const stream = toTagged<StreamName>('facts.github.pull_request');
  const log = createMemoryFactLog([stream]);

  const pullRequests = new Map<string, PullRequestRow>();
  const waiting = new Map<string, WaitingRow>();
  const blobs = new Map<string, Uint8Array>();

  const reviewRequestSchema = z.object({
    action: z.literal('review_requested'),
    pull_request: z.object({ id: z.number(), title: z.string() }),
    requested_reviewer: z.object({ id: z.number() }),
  });

  const webhook: ReceivePath = {
    kind: 'receive',
    route: '/webhooks/github',
    receive: async (request) => {
      const body = await request.text();

      const signature = `sha256=${new Bun.CryptoHasher('sha256', secret).update(body).digest('hex')}`;

      if (request.headers.get('x-hub-signature-256') !== signature) {
        return { kind: 'refused', status: 401, reason: 'bad signature' };
      }

      const delivery = request.headers.get('x-github-delivery') ?? '';
      const payload = reviewRequestSchema.parse(JSON.parse(body));

      return {
        kind: 'batch',
        batch: {
          facts: [
            {
              stream,
              blobs: [],
              fact: {
                id: buildWebhookFactID({ source: 'github', deliveryID: delivery }),
                type: 'pull_request.review_requested',
                v: 1,
                api: 'github/2022-11-28',
                entity: toTagged<EntityID>(`github:pr:${payload.pull_request.id}`),
                at: '2026-10-01T08:00:00Z',
                payload,
              },
            },
          ],
        },
      };
    },
  };

  const pullRequestConsumer = (
    input: FactInput,
  ): ConsumerOutcome<FactOperation<PullRequestRow, Registry>> => {
    const payload = reviewRequestSchema.parse(input.fact.payload);
    const reviewer = toTagged<EntityID>(`github:user:${payload.requested_reviewer.id}`);
    const pullRequest = input.fact.entity;

    if (!isEntityOfKind(pullRequest, ['github:pr']) || !isEntityOfKind(reviewer, ['github:user'])) {
      return { rejected: 'a review request runs from a pull request to a user' };
    }

    return {
      applied: [
        {
          upsert: {
            table: 'github_pull_request',
            row: { id: pullRequest, title: payload.pull_request.title, reviewer },
          },
        },
        {
          link: {
            type: 'review_requested',
            from: pullRequest,
            to: { kind: 'entity', id: reviewer },
            confidence: 1,
            evidence: 'the review_requested webhook',
          },
        },
      ],
    };
  };

  const pullRequestReads: ConsumerReads<PullRequestRow> = {
    getRow: (_table, key) => pullRequests.get(key),
    scanTable: () => [],
    readEntityFacts: () => [],
    readBlob: (hash) => blobs.get(hash),
  };

  const waitingOnMe = (
    input: ScopeInput,
    reads: ConsumerReads<PullRequestRow>,
  ): ConsumerOutcome<ScopeOperation<WaitingRow, Registry>> => {
    const pullRequest = reads.getRow('github_pull_request', input.scope);

    if (pullRequest?.reviewer !== toTagged<EntityID>('github:user:4401')) {
      return { applied: [] };
    }

    return {
      applied: [
        {
          upsert: {
            table: 'waiting_on_me',
            row: { id: pullRequest.id, reason: 'review-requested', since: '2026-10-01T08:00:00Z' },
          },
        },
      ],
    };
  };

  const feed: ChangeFeed = {
    read: () =>
      Promise.resolve({
        kind: 'messages',
        messages: [...waiting.values()].map((row) => ({
          kind: 'change',
          type: 'waiting_on_me',
          key: row.id,
          value: row,
          oldValue: null,
          operation: 'insert',
        })),
        next: toTagged<StreamOffset>(waiting.size),
        atTail: true,
      }),
  };

  const runReviewRequest = async (request: Request) => {
    const received = await webhook.receive(request);

    invariant(received.kind === 'batch', 'the trace sends a signed review request');

    for (const pending of received.batch.facts) {
      await log.append(pending.stream, pending.fact);
    }

    const read = await log.read(stream, toTagged<StreamOffset>(0), 100);

    invariant(read.ok, 'the memory log holds the pull request stream');

    for (const stored of read.value) {
      const outcome = pullRequestConsumer({
        mode: 'fact',
        offset: stored.offset,
        fact: stored.fact,
      });

      invariant('applied' in outcome, 'the pull request consumer applies a review request');

      for (const operation of outcome.applied) {
        if ('upsert' in operation) {
          pullRequests.set(operation.upsert.row.id, operation.upsert.row);
        }
      }

      const scope = toTagged<ScopeID>(stored.fact.entity);
      const answer = waitingOnMe({ mode: 'scope', scope }, pullRequestReads);

      invariant('applied' in answer, 'the waiting-on-me consumer answers every scope');

      for (const operation of answer.applied) {
        if ('upsert' in operation) {
          waiting.set(operation.upsert.row.id, operation.upsert.row);
        }
      }
    }

    return feed.read({ consumer: 'waiting_on_me', generation: 1 }, -1, 'catch-up');
  };

  return { runReviewRequest };
}

test('it carries a signed review request from the webhook to a waiting-on-me row and its change message', async () => {
  const ctx = setupTest();

  const body = JSON.stringify({
    action: 'review_requested',
    pull_request: { id: 12, title: 'Add the harbour map and tides' },
    requested_reviewer: { id: 4401 },
  });

  const signature = new Bun.CryptoHasher('sha256', 'harbour-webhook-secret')
    .update(body)
    .digest('hex');

  const read = await ctx.runReviewRequest(
    new Request('http://pepys.test/webhooks/github', {
      method: 'POST',
      headers: {
        'x-github-delivery': 'delivery-7',
        'x-hub-signature-256': `sha256=${signature}`,
      },
      body,
    }),
  );

  expect(read).toStrictEqual({
    kind: 'messages',
    messages: [
      {
        kind: 'change',
        type: 'waiting_on_me',
        key: 'github:pr:12',
        value: { id: 'github:pr:12', reason: 'review-requested', since: '2026-10-01T08:00:00Z' },
        oldValue: null,
        operation: 'insert',
      },
    ],
    next: toTagged<StreamOffset>(1),
    atTail: true,
  });
});
