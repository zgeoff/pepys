// Trace: a GitHub review request reaches "waiting on me". It wires the contracts end to end and
// only has to compile; no test runs it.
import type { ChangeFeed, FeedRead } from '../change-feed.ts';
import type {
  ConsumerOutcome,
  ConsumerReads,
  FactInput,
  FactOperation,
  ScopeInput,
  ScopeOperation,
} from '../consumer-execution.ts';
import type { AppendOutcome, FactLog } from '../fact-log.ts';
import type { EntityID, ScopeID, StreamOffset, VersionHash } from '../ids.ts';
import type { KindedID, LinkRegistryOf, LinkTypeDeclaration } from '../link-registry.ts';
import type { CatalogEntry, Principal } from '../query-catalog.ts';
import type { ReceivePath } from '../source.ts';

type Registry = LinkRegistryOf<LinkTypeDeclaration<'review_requested', 'github:pr', 'github:user'>>;

interface WaitingRow {
  id: EntityID;
  reason: 'review-requested' | 'assigned' | 'needs-reply';
  since: string;
}

type PullRequestOutcome = ConsumerOutcome<FactOperation<unknown, Registry>>;

type WaitingOutcome = ConsumerOutcome<ScopeOperation<WaitingRow, Registry>>;

export interface ReviewRequestTrace {
  webhook: ReceivePath;

  // The ingest core's writer. In the real core no source calls it.
  log: FactLog;
  pullRequestConsumer: (input: FactInput, reads: ConsumerReads<unknown>) => PullRequestOutcome;
  waitingOnMe: (input: ScopeInput, reads: ConsumerReads<WaitingRow>) => WaitingOutcome;
  reads: { pullRequest: ConsumerReads<unknown>; waiting: ConsumerReads<WaitingRow> };
  feed: ChangeFeed;
  waitingQuery: CatalogEntry<{ limit: number }, { rows: readonly WaitingRow[] }, unknown>;
  owner: Principal;
}

export interface ReviewRequestEvent {
  request: Request;
  offset: StreamOffset;
  pullRequest: KindedID<'github:pr'>;
  generation: VersionHash;
}

export async function runReviewRequestTrace(
  trace: ReviewRequestTrace,
  event: ReviewRequestEvent,
): Promise<
  | { kind: 'not-received' }
  | {
      kind: 'served';
      appended: AppendOutcome;
      outcomes: readonly [PullRequestOutcome, WaitingOutcome];
      feed: FeedRead;
      rows: readonly WaitingRow[];
    }
> {
  const received = await trace.webhook.receive(event.request);

  const pending = received.kind === 'batch' ? received.batch.facts[0] : undefined;

  if (pending === undefined) {
    return { kind: 'not-received' };
  }

  const appended = await trace.log.append(pending.stream, pending.fact);

  const pullRequestOutcome = trace.pullRequestConsumer(
    { mode: 'fact', offset: event.offset, fact: pending.fact },
    trace.reads.pullRequest,
  );

  const waitingOutcome = trace.waitingOnMe(
    { mode: 'scope', scope: toScope(event.pullRequest) },
    trace.reads.waiting,
  );

  const feed = await trace.feed.read(
    { consumer: 'waiting_on_me', generation: event.generation },
    -1,
    'catch-up',
  );

  const answer = await trace.waitingQuery.run(undefined, trace.owner, { limit: 20 });

  return {
    kind: 'served',
    appended,
    outcomes: [pullRequestOutcome, waitingOutcome],
    feed,
    rows: answer.ok ? answer.value.rows : [],
  };
}

declare function toScope(id: EntityID): ScopeID;
