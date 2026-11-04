import type { FactEnvelope } from '@pepys/schema';
import type { Pins } from './champion-challenger.ts';
import type { BlobHash, EntityID, FactID, ScopeID, StreamOffset, VersionHash } from './ids.ts';
import type { EntityKind, LinkEnds, LinkRegistry } from './link-registry.ts';

// What the host passes a consumer on one call: one module export per mode. A fact-mode consumer
// gets the next fact of its one stream. A scope-mode consumer gets the scope that changed and
// recomputes everything it owns for it.
export type ConsumerInput = FactInput | ScopeInput;

export interface FactInput {
  mode: 'fact';
  offset: StreamOffset;
  fact: FactEnvelope<unknown>;
}

export interface ScopeInput {
  mode: 'scope';
  scope: ScopeID;
}

// The four reads on the wire. All four go through one pair of host imports that take a JSON
// request, so the host links the same two functions for every consumer.
export type ReadRequest =
  | { row: { table: string; key: string } }
  | { scan: { table: string; index: string; prefix: readonly string[] } }
  | { facts: EntityID }
  | { blob: BlobHash };

// The host checks every read against this. A fact-mode call reads its own tables and earlier facts
// of its stream. A scope-mode call reads only other consumers' rows whose scope column equals the
// scope, and the scope entity's facts.
export type ReadLimit = { mode: 'fact'; before: StreamOffset } | { mode: 'scope'; scope: ScopeID };

// The reads as the generated glue gives them to a module.
export interface ConsumerReads<Row> {
  getRow: (table: string, key: string) => Row | undefined;

  // Rows in index order whose index columns start with `prefix`.
  scanTable: (table: string, index: string, prefix: readonly string[]) => readonly Row[];

  // Facts for one entity from the fact index, sorted by source time, then by stream offset.
  readEntityFacts: (entity: EntityID) => readonly FactEnvelope<unknown>[];

  // A blob read is pure, because a hash always names the same bytes.
  readBlob: (hash: BlobHash) => Uint8Array | undefined;
}

// A link as a consumer returns it. The host fills in the scope and the origin, so a consumer
// cannot write a link into another scope.
export type ConsumerLink<Registry extends LinkRegistry> = LinkEnds<Registry> & {
  confidence: number;
  evidence: string;
};

// One key names the verb, in the JSON shape the generated glue writes.
export type FactOperation<Row, Registry extends LinkRegistry> =
  | { upsert: { table: string; row: Row } }
  | { delete: { table: string; key: string } }
  | { link: ConsumerLink<Registry> }
  | { unlink: LinkEnds<Registry> };

// A scope answer is the whole set of rows and links the consumer owns for the scope, so it has no
// delete: the host deletes each row and link of the scope that the answer leaves out. The host
// refuses an answer that names a row key or a link that another scope holds.
export type ScopeOperation<Row, Registry extends LinkRegistry> =
  | { upsert: { table: string; row: Row } }
  | { link: ConsumerLink<Registry> };

// What every call returns. A consumer ignores a fact with an empty `applied`. The host counts a
// trap, and an answer of any other shape, as `rejected`, so a malformed answer never reads as an
// empty set that deletes the scope's rows.
export type ConsumerOutcome<Operation> = { applied: readonly Operation[] } | { rejected: string };

// The manifest that the build writes into a custom section of each module, generated from the
// declaration with the Rust type that reads it. The host learns a consumer from its module alone,
// and the version hash covers the manifest because it covers the module.
export interface ConsumerManifest {
  name: string;
  mode:
    | { kind: 'fact'; stream: string }
    | { kind: 'scope'; scopeKind: EntityKind; sources: Readonly<Record<string, string>> };
  tables: Readonly<
    Record<string, { primaryKey: readonly string[]; indexes: readonly (readonly string[])[] }>
  >;
  links: readonly string[];
  schema: string;
}

// Why a consumer stopped. The host writes one into the consumer's file in the transaction that
// commits everything before the input, so the offset never passes it. The consumer moves again
// only when the owner runs `pepys up` with a version that applies the input.
export type Halt =
  | { kind: 'rejected-fact'; offset: StreamOffset; fact: FactID; reason: string }
  | { kind: 'rejected-scope'; scope: ScopeID; reason: string }
  | { kind: 'refused-operation'; at: StreamOffset | ScopeID; reason: string };

// A consumer version is its module plus the job champions it reads, so a job promotion gives each
// reader a new version.
export interface ConsumerVersion {
  name: string;
  module: VersionHash;
  pins: Pins;
  version: VersionHash;
  manifest: ConsumerManifest;
}
