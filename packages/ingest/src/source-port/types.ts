import type {
  BlobHash,
  ConsumerDeclaration,
  EntityKind,
  FactEnvelope,
  LinkTypeDeclaration,
  Result,
  StreamName,
} from '@pepys/kit';

export interface FactFamily<Payload> {
  stream: StreamName;
  types: readonly string[];
  api: string;
  parsePayload: (raw: unknown) => Result<Payload, { reason: string }>;
}

// Provisional: source-retention
export interface SourceDefinition {
  name: string;
  families: readonly FactFamily<unknown>[];
  entityKinds: readonly EntityKind[];
  linkTypes: readonly LinkTypeDeclaration[];
  consumers: readonly ConsumerDeclaration[];
  live: ReceivePath | PullPath;
  recovery: PullPath;
  backfill: PullPath;
  resync: PullPath;
}

export interface ReceivePath {
  kind: 'receive';
  route: string;
  receive: (request: Request) => Promise<Received>;
}

export type Received =
  | { kind: 'refused'; status: 400 | 401 | 405 | 422; reason: string }
  | { kind: 'ignored' }
  | { kind: 'batch'; batch: Batch };

export interface PullPath {
  kind: 'pull';
  name: string;
  intervalMs: number | null;
  pull: (cursor: string | null) => Promise<Pulled>;
}

// Provisional: source-retention
export type Pulled =
  | { kind: 'batch'; batch: Batch; cursor: string; isDone: boolean }
  | { kind: 'expired' }
  | { kind: 'unavailable'; retryAfterMs: number }
  | { kind: 'rejected'; reason: string };

export interface Batch {
  facts: readonly PendingFact[];
}

export interface PendingFact {
  stream: StreamName;
  fact: FactEnvelope<unknown>;
  blobs: readonly { hash: BlobHash; bytes: Uint8Array }[];
}

export interface Ingest {
  routes: Readonly<Record<string, (request: Request) => Promise<Response>>>;
  start: () => void;
  stop: () => Promise<void>;
  runCommand: (command: IngestCommand) => Promise<Result<{ facts: number }, { reason: string }>>;
}

export interface IngestCommand {
  source: string;
  path: 'backfill' | 'recovery' | 'resync';
}
