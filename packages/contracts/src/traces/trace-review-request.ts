// Trace: a GitHub review request reaches "waiting on me". It wires the contracts end to end and
// only has to compile; no test runs it.
import type { FactEnvelope } from '@pepys/schema';
import type { ChangeFeed, FeedRead } from '../change-feed.ts';
import type { ConsumerInput, ConsumerOutcome, ConsumerReads } from '../consumer-execution.ts';
import type { AppendOutcome, FactLog } from '../fact-log.ts';
import type { EntityID, ScopeID, StreamName, StreamOffset, VersionHash } from '../ids.ts';
import type { KindedID, LinkTypeDeclaration } from '../link-registry.ts';
import type { CatalogEntry, Principal } from '../query-catalog.ts';
import type { IngestPorts, PushPath } from '../source.ts';

type ReviewRequested = LinkTypeDeclaration<'review_requested', 'github:pr', 'github:user'>;

interface WaitingRow {
  id: EntityID;
  reason: 'review-requested' | 'assigned' | 'needs-reply';
  since: string;
}

export interface ReviewRequestTrace {
  webhook: PushPath;
  ports: IngestPorts;
  log: FactLog;
  pullRequestConsumer: (
    input: ConsumerInput,
    reads: ConsumerReads<unknown>,
  ) => ConsumerOutcome<unknown, ReviewRequested>;
  waitingOnMe: (
    input: ConsumerInput,
    reads: ConsumerReads<WaitingRow>,
  ) => ConsumerOutcome<WaitingRow>;
  reads: { pullRequest: ConsumerReads<unknown>; waiting: ConsumerReads<WaitingRow> };
  feed: ChangeFeed;
  waitingQuery: CatalogEntry<{ limit: number }, { rows: readonly WaitingRow[] }, unknown>;
  owner: Principal;
}

export interface ReviewRequestEvent {
  request: Request;
  fact: FactEnvelope<unknown>;
  offset: StreamOffset;
  pullRequest: KindedID<'github:pr'>;
  generation: VersionHash;
}

export async function runReviewRequestTrace(
  trace: ReviewRequestTrace,
  event: ReviewRequestEvent,
): Promise<{
  appended: AppendOutcome;
  outcomes: readonly [ConsumerOutcome<unknown, ReviewRequested>, ConsumerOutcome<WaitingRow>];
  feed: FeedRead;
  rows: readonly WaitingRow[];
}> {
  await trace.webhook.receive(event.request, trace.ports);

  const stream = toStream('facts.github.pull_request');

  const appended = await trace.log.append(stream, event.fact);

  const pullRequestOutcome = trace.pullRequestConsumer(
    { kind: 'fact', stream, offset: event.offset, fact: event.fact },
    trace.reads.pullRequest,
  );

  const waitingOutcome = trace.waitingOnMe(
    { kind: 'scope', scope: toScope(event.pullRequest) },
    trace.reads.waiting,
  );

  const feed = await trace.feed.read(
    { consumer: 'waiting_on_me', generation: event.generation },
    -1,
    'catch-up',
  );

  const answer = await trace.waitingQuery.run(undefined, trace.owner, { limit: 20 });

  return {
    appended,
    outcomes: [pullRequestOutcome, waitingOutcome],
    feed,
    rows: answer.ok ? answer.value.rows : [],
  };
}

declare function toStream(name: string): StreamName;
declare function toScope(id: EntityID): ScopeID;
