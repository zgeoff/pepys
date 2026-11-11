import type {
  BucketNumber,
  EntityID,
  Pins,
  Result,
  ScopeID,
  StreamOffset,
  VersionHash,
} from '@pepys/schema';

export type Subject =
  | { kind: 'consumer'; name: string }
  | { kind: 'job'; name: string }
  | { kind: 'ranking'; name: string };

export type SubjectKind = Subject['kind'];

export type SubjectOf<Kind extends SubjectKind> = Extract<Subject, { kind: Kind }>;

export type VersionState = 'building' | 'previewed' | 'current' | 'previous' | 'removed';

export type VersionMove =
  | readonly ['building', 'previewed']
  | readonly ['building', 'current']
  | readonly ['previewed', 'current']
  | readonly ['current', 'previous']
  | readonly ['previous', 'current']
  | readonly ['previous', 'removed'];

export type Sample =
  | { kind: 'all' }
  | {
      kind: 'buckets';
      buckets: readonly BucketNumber[];
      modelCallCeiling: number;
    };

export interface VersionRecord<S extends Subject = Subject> {
  subject: S;
  version: VersionHash;
  state: VersionState;
  pins: Pins;
  sample: Sample;
}

export type PickBucket = (scope: ScopeID) => BucketNumber;

export interface VersionLedger<S extends Subject = Subject> {
  readChampion: (subject: S) => Promise<VersionRecord<S> | null>;
  findVersion: (subject: S, version: VersionHash) => Promise<VersionRecord<S> | null>;
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

export type Comparison =
  | { kind: 'offset'; offset: StreamOffset; pins: Pins }
  | { kind: 'processed-scopes'; scopes: readonly ScopeID[]; sample: Sample }
  | { kind: 'golden-queries'; queries: readonly GoldenQuery[] };

export interface GoldenQuery {
  text: string;
  expected: readonly EntityID[];
}

export interface RowDiff {
  added: readonly string[];
  changed: readonly string[];
  removed: readonly string[];
}

export type ScoreSource = 'label-corrections' | 'manual-links-and-retractions' | 'golden-queries';

export interface Score {
  source: ScoreSource;
  value: number;
  threshold: number | null;
  support: number;
}

export type ReportSection =
  | { kind: 'diff'; tables: Readonly<Record<string, RowDiff>> }
  | { kind: 'score'; score: Score }
  | { kind: 'cost'; plannedModelCalls: number; modelCalls: number; durationMs: number }
  | { kind: 'coverage'; sampled: number; total: number };

export interface EvaluationReport<S extends Subject = Subject> {
  subject: S;
  champion: VersionHash | null;
  challenger: VersionHash;
  comparison: Comparison;
  sections: readonly ReportSection[];
}

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

export interface PlanStore {
  findOpen: (subject: Subject) => Promise<PromotionPlan | null>;
  create: (plan: PromotionPlan) => Promise<Result<void, { reason: 'plan-open'; open: string }>>;
  mark: (plan: string, index: number, state: StepState) => Promise<void>;
  close: (plan: string) => Promise<void>;
}

export type PromotionGate = (
  report: EvaluationReport,
) => { kind: 'promote' } | { kind: 'refuse'; reason: string };

export type PromotionOutcome =
  | { kind: 'promoted'; plan: PromotionPlan }
  | { kind: 'already-champion' }
  | { kind: 'refused'; reason: string }
  | { kind: 'stopped'; plan: PromotionPlan; at: PromotionStep; failure: StepFailure };

export interface ChallengerRun {
  diff: Readonly<Record<string, RowDiff>>;
  outputs: ChallengerOutputs;
  cost: { plannedModelCalls: number; modelCalls: number; durationMs: number };
  coverage: { sampled: number; total: number } | null;
}

export interface ChallengerOutputs {
  jobFacts: { job: string; version: VersionHash; scopes: readonly ScopeID[] } | null;
  rankings: ReadonlyMap<string, readonly EntityID[]> | null;
}

export type ChallengeFailure =
  | { reason: 'unknown-version' }
  | { reason: 'no-champion-input' }
  | { reason: 'over-model-call-ceiling'; planned: number; ceiling: number }
  | { reason: 'run-failed'; detail: string };

export interface Arena<S extends Subject> {
  ledger: VersionLedger<S>;
  fixComparison: (subject: S, champion: VersionRecord<S> | null) => Promise<Comparison>;
  runChallenger: (
    subject: S,
    challenger: VersionRecord<S>,
    comparison: Comparison,
  ) => Promise<Result<ChallengerRun, ChallengeFailure>>;
  scoreSources: (subject: S) => readonly ScoreSource[];
  planPromotion: (subject: S, challenger: VersionRecord<S>) => Promise<readonly PromotionStep[]>;
}

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
