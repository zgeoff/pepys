import type { BucketNumber, EntityID, ScopeID, StreamOffset, VersionHash } from './ids.ts';

// What a challenger is compared on, for each versioned thing.
export type EvaluationInput =
  | { kind: 'consumer'; consumer: string; offset: StreamOffset }
  | { kind: 'job'; job: string; scopes: readonly ScopeID[]; buckets: readonly BucketNumber[] }
  | { kind: 'ranking'; goldenQueries: readonly GoldenQuery[] };

// A fixed query with the results the owner expects, in order.
export interface GoldenQuery {
  text: string;
  expected: readonly EntityID[];
}

// The labelled data a score uses. A thing with no labelled data reports the diff alone.
export type ScoreSource =
  | { kind: 'label-corrections' }
  | { kind: 'manual-links-and-retractions' }
  | { kind: 'golden-queries' }
  | { kind: 'none' };

export interface RowDiff {
  added: readonly string[];
  changed: readonly string[];
  removed: readonly string[];
}

// The report the owner reads before promotion.
export interface EvaluationReport {
  champion: VersionHash | null;
  challenger: VersionHash;
  input: EvaluationInput;
  diff: Readonly<Record<string, RowDiff>>;
  score: { source: ScoreSource; value: number | null; threshold: number | null };
  cost: { modelCalls: number; durationMs: number };
}

// The champion of one consumer or job, as the host or enrichment records it.
export interface ChampionRecord {
  thing: { kind: 'consumer'; name: string } | { kind: 'job'; name: string };
  champion: VersionHash;
  previous: VersionHash | null;
}

// The steps `pepys up enrich <job>` takes, in order. A consumer that kept its rows after the third
// step would still hold the old champion's output, so the host rebuilds every one that reads the
// job's facts.
export type JobPromotionStep =
  | { kind: 'run-remaining-scopes'; job: string; version: VersionHash }
  | { kind: 'record-champion'; job: string; version: VersionHash }
  | { kind: 'rebuild-consumer'; consumer: string };

// Puts a scope in its bucket from a hash of its ID. A replay gives the same bucket.
export type PickBucket = (scope: ScopeID) => BucketNumber;
