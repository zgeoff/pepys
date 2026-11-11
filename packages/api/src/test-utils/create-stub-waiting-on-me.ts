import type { FactLog } from '@pepys/ingest';
import type { EntityID, LinkTypeDeclaration, ScopeID, StreamName, StreamOffset } from '@pepys/kit';
import { isEntityOfKind } from '@pepys/schema';
import type {
  ConsumerOutcome,
  ConsumerReads,
  FactInput,
  FactOperation,
  LinkRegistryOf,
  ScopeInput,
  ScopeOperation,
} from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import type { ChangeFeed } from '../change-feed/change-feed.ts';
import { reviewRequestPayloadSchema } from './review-request-payload-schema.ts';

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

interface StubWaitingOnMe {
  log: FactLog;
  stream: StreamName;
  owner: EntityID;
}

export function createStubWaitingOnMe(options: StubWaitingOnMe) {
  const pullRequests = new Map<string, PullRequestRow>();
  const waiting = new Map<string, WaitingRow>();

  const pullRequestReads: ConsumerReads<PullRequestRow> = {
    getRow: (_table, key) => pullRequests.get(key),
    scanTable: () => [],
    readEntityFacts: () => [],
    readBlob: (hash) => new Map<string, Uint8Array>().get(hash),
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

  const apply = async () => {
    const read = await options.log.read(options.stream, toTagged<StreamOffset>(0), 100);

    invariant(read.ok, 'the stub reads a stream the log holds');

    for (const stored of read.value) {
      const outcome = runPullRequestConsumer({
        mode: 'fact',
        offset: stored.offset,
        fact: stored.fact,
      });

      invariant('applied' in outcome, 'the stub stores only review requests it can apply');

      for (const operation of outcome.applied) {
        if ('upsert' in operation) {
          pullRequests.set(operation.upsert.row.id, operation.upsert.row);
        }
      }

      const scope = toTagged<ScopeID>(stored.fact.entity);
      const answer = runWaitingOnMe({ mode: 'scope', scope }, pullRequestReads, options.owner);

      invariant('applied' in answer, 'the waiting-on-me stub answers every scope');

      for (const operation of answer.applied) {
        waiting.set(operation.upsert.row.id, operation.upsert.row);
      }
    }
  };

  return { apply, feed };
}

type Registry = LinkRegistryOf<
  LinkTypeDeclaration<'review_requested', 'github:pull_request', 'github:user'>
>;

function runPullRequestConsumer(
  input: FactInput,
): ConsumerOutcome<FactOperation<PullRequestRow, Registry>> {
  const payload = reviewRequestPayloadSchema.parse(input.fact.payload);
  const reviewer = toTagged<EntityID>(`github:user:${payload.requested_reviewer.id}`);
  const pullRequest = input.fact.entity;

  if (
    !isEntityOfKind(pullRequest, ['github:pull_request']) ||
    !isEntityOfKind(reviewer, ['github:user'])
  ) {
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
}

function runWaitingOnMe(
  input: ScopeInput,
  reads: ConsumerReads<PullRequestRow>,
  owner: EntityID,
): ConsumerOutcome<Extract<ScopeOperation<WaitingRow, Registry>, { upsert: unknown }>> {
  const pullRequest = reads.getRow('github_pull_request', input.scope);

  if (pullRequest?.reviewer !== owner) {
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
}
