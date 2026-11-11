import type { AppendBatchOutcome, BlobStore } from '@pepys/ingest';
import type {
  EntityID,
  FactEnvelope,
  FactID,
  Result,
  ScopeID,
  StreamName,
  VersionHash,
} from '@pepys/kit';

export interface JobDefinition<Value, Output> {
  name: string;
  version: JobVersion;
  resultStream: StreamName;
  trigger: TriggerRule<Value>;
  run: (input: JobInput<Value>, ports: JobPorts) => Promise<Result<Output, { reason: string }>>;
}

export interface JobVersion {
  job: string;
  version: VersionHash;
  scoreThreshold: number | null;
  modelCallsPerInput: number;
}

export interface TriggerRule<Value> {
  table: string;
  matches: (change: TriggerChange<Value>) => boolean;
  toScope: (change: TriggerChange<Value>) => ScopeID;
}

export interface TriggerChange<Value> {
  key: string;
  value: Value;
}

export interface JobInput<Value> {
  scope: ScopeID;
  entity: EntityID;
  value: Value;
  inputHash: string;
}

export interface JobPorts {
  blobs: BlobStore;
  writeResult: (fact: FactEnvelope<JobResult<unknown>>) => Promise<AppendBatchOutcome>;
  hasResult: (id: FactID) => Promise<boolean>;
}

export interface JobResult<Output> {
  job: string;
  version: VersionHash;
  inputHash: string;
  output: Output;
}

export type JobOutcome =
  | { kind: 'written'; fact: FactID }
  | { kind: 'skipped'; fact: FactID }
  | { kind: 'failed'; reason: string; retryAfterMs: number | null };

export type JobFactVisibility = (fact: JobFactVersion) => boolean;

export interface JobFactVersion {
  job: string;
  version: VersionHash;
}
