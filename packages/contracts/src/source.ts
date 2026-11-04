import type { ConsumerDeclaration, FactEnvelope, Result } from '@pepys/schema';
import type { BlobStore } from './blob-store.ts';
import type { AppendOutcome, FactLog } from './fact-log.ts';
import type { StreamName } from './ids.ts';
import type { EntityKind, LinkTypeDeclaration } from './link-registry.ts';

// One fact family: its stream, the fact types in it, and how a payload is checked.
export interface FactFamily<Payload> {
  stream: StreamName;
  types: readonly string[];

  // The source API version that produced the payload, such as `github/2022-11-28`.
  api: string;
  parsePayload: (raw: unknown) => Result<Payload, { reason: string }>;
}

// The ports an ingest path gets. A path writes blobs before the facts that reference them, then the
// facts, then its cursor, so a fact never points at a missing blob.
export interface IngestPorts {
  log: FactLog;
  blobs: BlobStore;
  cursors: CursorStore;
}

// The last position a poller reached in its source, kept as a fact in `facts.cursors`.
export interface CursorStore {
  read: (path: string) => Promise<string | undefined>;
  write: (path: string, cursor: string) => Promise<AppendOutcome>;
}

// A path that receives pushes, such as GitHub webhooks. The deployment mounts it on one route.
export interface PushPath {
  kind: 'push';
  route: string;

  // Checks the request before anything is written; an unsigned request gets no further work.
  receive: (request: Request, ports: IngestPorts) => Promise<Response>;
}

// A path that polls from a cursor, such as Gmail's `history.list`.
export interface PollPath {
  kind: 'poll';
  intervalMs: number;
  poll: (ports: IngestPorts) => Promise<PollOutcome>;
}

// The outcome of one poll. An expired cursor means the source dropped its history.
export type PollOutcome =
  | { kind: 'polled'; facts: number }
  | { kind: 'cursor-expired' }
  | { kind: 'source-unavailable'; retryAfterMs: number };

// A path the owner runs by command, such as a backfill or a full resync.
export interface CommandPath {
  kind: 'command';
  name: string;
  run: (
    ports: IngestPorts,
    args: readonly string[],
  ) => Promise<Result<{ facts: number }, { reason: string }>>;
}

// The source port: everything one source brings. A new source adds its own streams, tables and
// consumers, and changes nothing another source owns.
export interface SourceDefinition {
  // The first part of every entity ID the source names, such as `github`.
  name: string;
  families: readonly FactFamily<unknown>[];
  entityKinds: readonly EntityKind[];
  linkTypes: readonly LinkTypeDeclaration[];
  consumers: readonly ConsumerDeclaration[];
  live: PushPath | PollPath;

  // Finds what the live path missed, such as failed webhook deliveries.
  recovery: PollPath | CommandPath;
  backfill: CommandPath;

  // Runs when recovery reports the source dropped its history: observations of every object.
  resync: CommandPath;
}

// Builds one fact envelope for a family. Ingest paths call it so every fact is checked.
export type BuildFact = <Payload>(
  family: FactFamily<Payload>,
  fact: Omit<FactEnvelope<Payload>, 'v' | 'api'>,
) => FactEnvelope<Payload>;
