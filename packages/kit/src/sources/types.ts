import type { z } from 'zod';
import type { BlobHash, EntityID, StreamName } from '../ids/types.ts';
import type { EntityKind } from '../link-types/types.ts';
import type { DeclaredStreamName, FactEnvelope } from '../types.ts';

export interface FactFamily<
  Types extends Readonly<Record<string, z.ZodType>> = Readonly<Record<string, z.ZodType>>,
  Kind extends EntityKind = EntityKind,
> {
  readonly stream: DeclaredStreamName;
  readonly api: string;

  // the kind of the `entity` of every fact of the family
  readonly entityKind: Kind;

  // one zod schema per fact type; a fact type belongs to one family in the deployment
  readonly types: Types;
}

// A source holds no secret and reads no environment.
export interface SourceDefinition<Family extends FactFamily = FactFamily> {
  readonly name: string;
  readonly families: readonly Family[];
  readonly live?: ReceivePath | PullPath | undefined;
  readonly recovery?: PullPath | undefined;
  readonly backfill?: PullPath | undefined;
  readonly resync?: PullPath | undefined;
}

// Ingest owns every step of a delivery but `read`: the method, the size, the check, the sender, the
// decoding, the fact limit, the appends and the answer.
export interface ReceivePath {
  readonly kind: 'receive';
  readonly route: string;

  // More routes that pass the same check and sender, answer as an ignored delivery, and store
  // nothing. An OTLP exporter sends metrics and traces beside its logs, and retries a refusal.
  readonly ignoredRoutes?: readonly string[] | undefined;
  readonly check: DeliveryCheck;

  // Default 1 MiB, for the body as sent and for the body after decoding.
  readonly bodyByteLimit?: number | undefined;

  // Default 100 facts in one delivery.
  readonly factLimit?: number | undefined;

  // The `content-encoding` values the path takes besides none. Default none.
  readonly encodings?: readonly 'gzip'[] | undefined;

  // 'status' (default): 200 {"status":"stored","stored":<n>}, or 202 {"status":"ignored"}.
  // 'empty': 200 {} for stored and for ignored, which an OTLP exporter expects.
  readonly answer?: 'status' | 'empty' | undefined;

  // A mark for the deployment's network rules. Default 'private'. It changes no answer.
  readonly reach?: 'public' | 'private' | undefined;

  // The path needs a proven sender: ingest answers 401 and stores nothing without one.
  readonly sender?: SenderRequirement | undefined;

  // Pure: it writes nothing.
  readonly read: (delivery: Delivery, source: SourceContext) => Received;
}

// `hmac-sha256`: the header holds `sha256=<hex of HMAC-SHA256(secret, body as sent)>`. `token`: it
// holds the secret, or `Bearer <secret>`. Neither signs a time, so a fact ID must come from the
// signed body, and a replay is then a copy that every consumer drops.
export interface DeliveryCheck {
  readonly kind: 'hmac-sha256' | 'token';
  readonly header: string;
  readonly secretEnv: string;
}

// The proof a path needs, as data. `kind` picks the adapter of the `SenderProof` port. The audience
// and the folder of trust documents belong to the deployment, so a plug-in names only the
// variables that hold them.
export interface SenderRequirement {
  readonly kind: 'imp-identity';
  readonly audienceEnv: string;
  readonly issuersEnv: string;
}

export interface Delivery {
  headers: Headers;

  // after the check passed, and after decoding
  body: Uint8Array;

  // Present on every call for a path with a `sender`. `read` never takes a sender from `headers`.
  sender?: Sender | undefined;
}

export interface Sender {
  readonly issuer: string;
  readonly subject: string;
  readonly name: string;
}

// The port ingest calls for a path with a `sender`. It answers null when nothing proves a sender.
export interface SenderProof {
  prove: (requirement: SenderRequirement, headers: Headers) => Promise<Sender | null>;
}

export interface SourceContext {
  name: string;
  families: readonly FactFamily[];
}

// Ingest answers 401, 405, 413 and 415 itself, so `read` refuses with 400 or 422 only.
export type Received =
  | { kind: 'refused'; status: 400 | 422; reason: string }
  | { kind: 'ignored' }
  | { kind: 'batch'; batch: Batch };

// Ingest reads the variables in `env` at start and passes their values.
export interface PullPath {
  readonly kind: 'pull';
  readonly name: string;
  readonly intervalMs: number | null;
  readonly env?: readonly string[] | undefined;
  readonly pull: (cursor: string | null, context: PullContext) => Promise<Pulled>;
}

export interface PullContext {
  env: Readonly<Record<string, string>>;

  // The time in milliseconds since the epoch, from the clock that ingest runs on.
  now: () => number;

  // For a `resync' pull, the source's marked entities when the pull starts; empty for any other
  // pull. Ingest removes each of these marks that no delivery set again once the batch the pull
  // returns is stored, so a pull that cannot read every marked entity answers `unavailable`.
  marks: readonly ResyncMark[];
}

// An entity whose row may be behind the source, with the locator of the last fact ingest stored
// for it, if that fact had one, and the SHA-256 of that fact's body as ingest received it. A resync
// fact ID that hashes the digest changes when a new body is stored, so the host applies it.
export interface ResyncMark {
  entity: EntityID;
  locator: string | undefined;
  lastBodyDigest: string | undefined;
}

export type Pulled =
  | { kind: 'batch'; batch: Batch; cursor: string; isDone: boolean }
  | { kind: 'expired' }
  | { kind: 'unavailable'; retryAfterMs: number }
  | { kind: 'rejected'; reason: string };

export interface Batch {
  facts: readonly PendingFact[];
}

// The body of a signed fact batch. Ingest builds each fact ID as `event:<source>:<event>`.
export interface FactBatchBody {
  v: 1;
  facts: readonly {
    type: string;
    event: string;
    entity: string;
    actor?: string | undefined;
    at: string;
    payload: unknown;
  }[];
}

export interface PendingFact {
  stream: StreamName;
  fact: FactEnvelope<unknown>;
  blobs: readonly { hash: BlobHash; bytes: Uint8Array }[];

  // What a source's resync pull needs to read the entity again, such as an API path. Ingest keeps
  // it beside the entity's mark, and stores it in no fact.
  locator?: string | undefined;
}
