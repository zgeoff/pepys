import type { FactEnvelope, Result } from '@pepys/schema';
import type { BlobStore } from './blob-store.ts';
import type { AppendOutcome } from './fact-log.ts';
import type { EntityID, FactID, ScopeID, StreamName, VersionHash } from './ids.ts';

// One change from the store's change feed that a job's trigger rule matched.
export interface JobInput<Value> {
  scope: ScopeID;
  entity: EntityID;
  value: Value;

  // A hash of every input the job reads, so the same input never runs twice for one version.
  inputHash: string;
}

// A job version is the hash of its code and its versioned data files: prompts, label sets and
// trigger rules. A change to any of them gives a new version without a rebuild.
export interface JobVersion {
  job: string;
  version: VersionHash;

  // The owner's threshold for the evaluation score, from the version's data file.
  scoreThreshold: number | null;

  // The most model calls one input can take, so a sample's cost is known before it runs.
  modelCallsPerInput: number;
}

// The ports a job run gets. A job never writes the store; its results return to the log.
export interface JobPorts {
  blobs: BlobStore;
  writeResult: (fact: FactEnvelope<JobResult<unknown>>) => Promise<AppendOutcome>;

  // Looks up the result fact ID in enrichment's own file, so a restart repeats no outside call.
  hasResult: (id: FactID) => Promise<boolean>;
}

// The payload of every enrichment fact.
export interface JobResult<Output> {
  job: string;
  version: VersionHash;
  inputHash: string;
  output: Output;
}

// The outcome of one run. A skipped input already has a result for this version.
export type JobOutcome =
  | { kind: 'written'; fact: FactID }
  | { kind: 'skipped'; fact: FactID }
  | { kind: 'failed'; reason: string; retryAfterMs: number | null };

export interface TriggerChange<Value> {
  key: string;
  value: Value;
}

// What decides which inputs a job runs on.
export interface TriggerRule<Value> {
  // The consumer table whose change feed the rule reads.
  table: string;
  matches: (change: TriggerChange<Value>) => boolean;
  toScope: (change: TriggerChange<Value>) => ScopeID;
}

// Whether a reader may see one job fact. The host builds it from a consumer version's pins and
// applies it to the stream and to the fact index, so a challenger's facts reach no consumer.
export type JobFactVisibility = (fact: JobFactVersion) => boolean;

export interface JobFactVersion {
  job: string;
  version: VersionHash;
}

export interface JobDefinition<Value, Output> {
  name: string;
  version: JobVersion;

  // Every version of the job writes here; readers see only their pinned version.
  resultStream: StreamName;
  trigger: TriggerRule<Value>;
  run: (input: JobInput<Value>, ports: JobPorts) => Promise<Result<Output, { reason: string }>>;
}
