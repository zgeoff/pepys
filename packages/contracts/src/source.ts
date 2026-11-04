import type { ConsumerDeclaration, FactEnvelope, Result } from '@pepys/schema';
import type { BlobHash, StreamName } from './ids.ts';
import type { EntityKind, LinkTypeDeclaration } from './link-registry.ts';

// One fact family: its stream, the fact types in it, and how a payload is checked.
export interface FactFamily<Payload> {
  stream: StreamName;
  types: readonly string[];

  // The source API version that produced the payload, such as `github/2022-11-28`.
  api: string;
  parsePayload: (raw: unknown) => Result<Payload, { reason: string }>;
}

// The source port: everything one source brings. A source holds no log, blob store or cursor
// store. Every path returns a batch, and the ingest core alone writes it: blobs, then facts, then
// the cursor, repeating an unknown append under the same fact ID.
export interface SourceDefinition {
  // The first part of every entity ID and stream the source owns, such as `github`.
  name: string;

  // The core refuses a batch with a fact outside these families.
  families: readonly FactFamily<unknown>[];
  entityKinds: readonly EntityKind[];
  linkTypes: readonly LinkTypeDeclaration[];
  consumers: readonly ConsumerDeclaration[];
  live: ReceivePath | PullPath;

  // Finds what the live path missed, such as failed webhook deliveries. Gmail passes its live
  // poll again: the same poll, resumed from the same cursor.
  recovery: PullPath;
  backfill: PullPath;

  // Runs when another path reports expired history. It starts with no cursor, and its last cursor
  // becomes the cursor of the path that expired.
  resync: PullPath;
}

// A path the source pushes to, such as GitHub webhooks. The core mounts it on one route.
export interface ReceivePath {
  kind: 'receive';
  route: string;

  // Checks the request and returns a batch. It has no way to write, so a refused request writes
  // nothing. A received batch moves no cursor.
  receive: (request: Request) => Promise<Received>;
}

export type Received =
  | { kind: 'refused'; status: 400 | 401 | 405 | 422; reason: string }
  | { kind: 'ignored' }
  | { kind: 'batch'; batch: Batch };

// A path the core calls from a cursor: a poll, a redelivery sweep, a backfill or a resync.
export interface PullPath {
  kind: 'pull';

  // Its key in `facts.cursors`, such as `gmail.history`. Two paths with one name share a cursor.
  name: string;

  // How often the core calls it. A path with none runs only by command.
  intervalMs: number | null;
  pull: (cursor: string | null) => Promise<Pulled>;
}

// `cursor` is where the next call starts, and holds a page token while pages remain. On `expired`
// the core starts the resync path. On `rejected` the core writes no cursor past the page and stops
// the path, so a page it could not turn into facts is never skipped unseen.
export type Pulled =
  | { kind: 'batch'; batch: Batch; cursor: string; isDone: boolean }
  | { kind: 'expired' }
  | { kind: 'unavailable'; retryAfterMs: number }
  | { kind: 'rejected'; reason: string };

// What one call produces. Each fact carries the blobs it names, so the core writes them first and
// a fact never names a blob that was not written.
export interface Batch {
  facts: readonly PendingFact[];
}

export interface PendingFact {
  stream: StreamName;
  fact: FactEnvelope<unknown>;
  blobs: readonly { hash: BlobHash; bytes: Uint8Array }[];
}

// The ingest core, built from the deployment's sources. It is the only caller of every path, and
// one lock per source keeps a command and the timer off the same cursor.
export interface Ingest {
  routes: Readonly<Record<string, (request: Request) => Promise<Response>>>;
  start: () => void;
  stop: () => Promise<void>;
  runCommand: (command: IngestCommand) => Promise<Result<{ facts: number }, { reason: string }>>;
}

// The operator commands. Each one comes from the source's definition, with no code per source.
export interface IngestCommand {
  source: string;
  path: 'backfill' | 'recovery' | 'resync';
}
