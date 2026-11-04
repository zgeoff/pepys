import type { ConsumerDeclaration } from '@pepys/schema';
import type { JobDefinition } from './enrichment-job.ts';
import type { EntityID } from './ids.ts';
import type { CatalogEntry } from './query-catalog.ts';
import type { SourceDefinition } from './source.ts';
import type {
  CandidateProposer,
  Embedder,
  MailClassifier,
  MimeTextExtractor,
  PairJudge,
  Ranker,
} from './strategies.ts';

// The strategy the owner picks for each step. pepys never switches strategies at runtime.
export interface StrategyPicks {
  mimeText: MimeTextExtractor;
  mailLabel: MailClassifier<string>;
  pairJudge: PairJudge;
  candidates: CandidateProposer;
  embedder: Embedder;
  ranker: Ranker;
}

// The deployment: the package that assembles one owner's pepys in code. It chooses the sources and
// holds what is personal to the owner.
export interface DeploymentDefinition<Context> {
  // The IDs that belong to the owner, so the identity consumer never guesses who the owner is.
  owner: readonly EntityID[];
  sources: readonly SourceDefinition[];
  strategies: StrategyPicks;
  jobs: readonly AnyJob[];

  // Consumers only this owner wants, such as the one behind "waiting on me".
  consumers: readonly ConsumerDeclaration[];
  queries: Readonly<Record<string, AnyQuery<Context>>>;
}

// A job's input type appears only in parameter positions, so `never` accepts every job; `unknown`
// would accept only a job that takes any input.
export type AnyJob = JobDefinition<never, unknown>;

export type AnyQuery<Context> = CatalogEntry<never, unknown, Context>;
