import type { Result } from '@pepys/schema';
import type { BucketNumber, EntityID, ScopeID, StreamOffset, VersionHash } from './ids.ts';

// The things that have a champion. A new kind, such as a link extractor set, adds one member here,
// and the mapped registries below fail the type check until it has an arena and its executors.
export type Subject =
  | { kind: 'consumer'; name: string }
  | { kind: 'job'; name: string }
  | { kind: 'ranking'; name: string };

export type SubjectKind = Subject['kind'];

export type SubjectOf<Kind extends SubjectKind> = Extract<Subject, { kind: Kind }>;

// The lifecycle every subject shares: `previewed` is a challenger and `current` is the champion.
// One fixture file holds the allowed moves, and the Rust and TypeScript tests both read it, so the
// host's consumer records and enrichment's job records stay one state machine.
export type VersionState = 'building' | 'previewed' | 'current' | 'previous' | 'removed';

export type VersionMove =
  | readonly ['building', 'previewed']
  | readonly ['building', 'current']
  | readonly ['previewed', 'current']
  | readonly ['current', 'previous']
  | readonly ['previous', 'current']
  | readonly ['previous', 'removed'];

// The job champions a version reads, by job name. They are part of a consumer version's identity:
// a job promotion gives each reader a new version, which `pepys up` builds to the side and swaps.
export type Pins = Readonly<Record<string, VersionHash>>;

// The part of a subject's input a version runs on. The sample sits outside the version hash, and a
// job's fact ID hashes the job, the version and the input, so widening keeps the written facts.
export type Sample =
  | { kind: 'all' }
  | {
      kind: 'buckets';
      buckets: readonly BucketNumber[];

      // A run whose planned model calls pass this ceiling is refused before its first call.
      modelCallCeiling: number;
    };

export interface VersionRecord<S extends Subject = Subject> {
  subject: S;
  version: VersionHash;
  state: VersionState;
  pins: Pins;
  sample: Sample;
}

// Puts a scope in its bucket from a hash of its ID. A replay gives the same bucket.
export type PickBucket = (scope: ScopeID) => BucketNumber;

// Each kind keeps its records with one owner: the host for consumers, enrichment for jobs, the
// deployment for the ranking. Only the owner writes them, and every driver reads them here.
export interface VersionLedger<S extends Subject = Subject> {
  readChampion: (subject: S) => Promise<VersionRecord<S> | null>;
  findVersion: (subject: S, version: VersionHash) => Promise<VersionRecord<S> | null>;

  // Moves along one allowed move. `swap` demotes the champion and promotes the challenger in one
  // transaction.
  move: (
    subject: S,
    version: VersionHash,
    to: VersionState,
  ) => Promise<Result<void, LedgerFailure>>;
  swap: (
    subject: S,
    from: VersionHash | null,
    to: VersionHash,
  ) => Promise<Result<void, LedgerFailure>>;
  writeSample: (
    subject: S,
    version: VersionHash,
    sample: Sample,
  ) => Promise<Result<void, LedgerFailure>>;
}

export type LedgerFailure =
  | { reason: 'not-recorded' }
  | { reason: 'no-such-move'; from: VersionState; to: VersionState }
  | { reason: 'removed' };

// What a challenger is compared on, fixed from the champion before the challenger runs. A
// consumer reads one stream, so one offset says where its champion stands.
export type Comparison =
  | { kind: 'offset'; offset: StreamOffset; pins: Pins }
  | { kind: 'processed-scopes'; scopes: readonly ScopeID[]; sample: Sample }
  | { kind: 'golden-queries'; queries: readonly GoldenQuery[] };

// A fixed query with the results the owner expects, in order.
export interface GoldenQuery {
  text: string;
  expected: readonly EntityID[];
}

export interface RowDiff {
  added: readonly string[];
  changed: readonly string[];
  removed: readonly string[];
}

// The labelled data a score uses. A subject with none reports the diff alone.
export type ScoreSource = 'label-corrections' | 'manual-links-and-retractions' | 'golden-queries';

export interface Score {
  source: ScoreSource;
  value: number;

  // From the challenger's version file; null when the version sets none.
  threshold: number | null;

  // How many labelled items the score rests on, so a score of 1 on 3 items reads as weak.
  support: number;
}

export type ReportSection =
  | { kind: 'diff'; tables: Readonly<Record<string, RowDiff>> }
  | { kind: 'score'; score: Score }
  | { kind: 'cost'; plannedModelCalls: number; modelCalls: number; durationMs: number }
  | { kind: 'coverage'; sampled: number; total: number };

// The one report the owner reads before promotion, for every kind.
export interface EvaluationReport<S extends Subject = Subject> {
  subject: S;
  champion: VersionHash | null;
  challenger: VersionHash;
  comparison: Comparison;
  sections: readonly ReportSection[];
}

// One step of a promotion. The steps are stored before the first one runs, so a promotion that
// stops resumes at its step. Each step is safe to run again.
export type PromotionStep =
  | { kind: 'widen-to-all'; job: string; version: VersionHash }
  | { kind: 'run-remaining-scopes'; job: string; version: VersionHash }
  | { kind: 'record-champion'; subject: Subject; version: VersionHash }
  | { kind: 'rebuild-consumer'; consumer: string; module: VersionHash; pins: Pins };

export type StepState = 'pending' | 'done' | 'failed';

export interface PromotionPlan {
  id: string;
  subject: Subject;
  challenger: VersionHash;
  steps: readonly { step: PromotionStep; state: StepState }[];
}

export type StepExecutors = {
  [Kind in PromotionStep['kind']]: (
    step: Extract<PromotionStep, { kind: Kind }>,
  ) => Promise<Result<void, StepFailure>>;
};

export type StepFailure =
  | { reason: 'retry-later'; retryAfterMs: number }
  | { reason: 'failed'; detail: string };

// Each owner keeps plans in its own file. A subject has at most one open plan, so a second
// promotion or a preview cannot replace the challenger that an open plan names.
export interface PlanStore {
  findOpen: (subject: Subject) => Promise<PromotionPlan | null>;
  create: (plan: PromotionPlan) => Promise<Result<void, { reason: 'plan-open'; open: string }>>;
  mark: (plan: string, index: number, state: StepState) => Promise<void>;
  close: (plan: string) => Promise<void>;
}

// Decides, with no prompt, whether a promotion goes ahead. The deployment picks one, so whether a
// score below its threshold refuses promotion is the deployment's choice.
export type PromotionGate = (
  report: EvaluationReport,
) => { kind: 'promote' } | { kind: 'refuse'; reason: string };

export type PromotionOutcome =
  | { kind: 'promoted'; plan: PromotionPlan }
  | { kind: 'already-champion' }
  | { kind: 'refused'; reason: string }
  | { kind: 'stopped'; plan: PromotionPlan; at: PromotionStep; failure: StepFailure };

// What a challenger run leaves for the report.
export interface ChallengerRun {
  diff: Readonly<Record<string, RowDiff>>;
  outputs: ChallengerOutputs;
  cost: { plannedModelCalls: number; modelCalls: number; durationMs: number };
  coverage: { sampled: number; total: number } | null;
}

// Handles on the challenger's output that only the scorers get, so no consumer and no query sees
// it before promotion.
export interface ChallengerOutputs {
  jobFacts: { job: string; version: VersionHash; scopes: readonly ScopeID[] } | null;
  rankings: ReadonlyMap<string, readonly EntityID[]> | null;
}

export type ChallengeFailure =
  | { reason: 'unknown-version' }
  | { reason: 'no-champion-input' }
  | { reason: 'over-model-call-ceiling'; planned: number; ceiling: number }
  | { reason: 'run-failed'; detail: string };

// The part of champion and challenger that differs by kind. The two drivers call only these.
export interface Arena<S extends Subject> {
  ledger: VersionLedger<S>;
  fixComparison: (subject: S, champion: VersionRecord<S> | null) => Promise<Comparison>;
  runChallenger: (
    subject: S,
    challenger: VersionRecord<S>,
    comparison: Comparison,
  ) => Promise<Result<ChallengerRun, ChallengeFailure>>;

  // Empty means the report is the diff alone.
  scoreSources: (subject: S) => readonly ScoreSource[];
  planPromotion: (subject: S, challenger: VersionRecord<S>) => Promise<readonly PromotionStep[]>;
}

// Mapped over every subject kind, so a new kind fails the type check until it has an arena.
export type ArenaRegistry = { [Kind in SubjectKind as Kind]: Arena<SubjectOf<Kind>> };

export type Scorers = Record<ScoreSource, Scorer>;

export type Scorer = (
  run: ChallengerRun,
  threshold: number | null,
) => Promise<Result<Score, { reason: 'no-labels' }>>;

export interface ChampionChallenger {
  arenas: ArenaRegistry;
  scorers: Scorers;
  executors: StepExecutors;
  gate: PromotionGate;
  plans: PlanStore;
}

export type Evaluate = <S extends Subject>(
  champions: ChampionChallenger,
  subject: S,
  challenger: VersionHash,
) => Promise<Result<EvaluationReport<S>, ChallengeFailure>>;

export type Promote = (
  champions: ChampionChallenger,
  subject: Subject,
  challenger: VersionHash,
) => Promise<Result<PromotionOutcome, ChallengeFailure>>;
