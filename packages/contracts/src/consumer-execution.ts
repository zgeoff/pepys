import type { ConsumerDeclaration, FactEnvelope } from '@pepys/schema';
import type { BlobHash, EntityID, ScopeID, StreamName, StreamOffset, VersionHash } from './ids.ts';
import type { Link, LinkTypeDeclaration } from './link-registry.ts';

// What the host passes a consumer on one call. A fact-mode consumer gets one fact at its offset. A
// scope-mode consumer gets the scope that changed and recomputes everything it owns for it.
export type ConsumerInput =
  | { kind: 'fact'; stream: StreamName; offset: StreamOffset; fact: FactEnvelope<unknown> }
  | { kind: 'scope'; scope: ScopeID };

// The reads a consumer may make. Every read sees the consumer's own file as it stood before the
// current batch, plus the operations already applied earlier in the same batch, so a replay gives
// the same answers as the live run.
export interface ConsumerReads<Row> {
  getRow: (table: string, key: string) => Row | undefined;

  // Rows in index order whose index columns start with `prefix`.
  scanTable: (table: string, index: string, prefix: readonly string[]) => readonly Row[];

  // Every fact for one entity from the fact index, sorted by source time, then by stream offset.
  readEntityFacts: (entity: EntityID) => readonly FactEnvelope<unknown>[];

  // A blob read is pure, because a hash always names the same bytes.
  readBlob: (hash: BlobHash) => Uint8Array | undefined;
}

// One write a consumer returns. The host rejects an operation on a table the consumer does not own.
export type ConsumerOperation<Row, Types extends LinkTypeDeclaration = LinkTypeDeclaration> =
  | { kind: 'upsert'; table: string; row: Row }
  | { kind: 'delete'; table: string; key: string }
  | { kind: 'link'; link: Link<Types> };

// A consumer's answer for one input. A scope-mode answer is the whole set of rows and links the
// consumer owns for that scope: the host deletes each owned row and link of the scope that the set
// leaves out, so a consumer never tracks what it wrote before.
export type ConsumerOutcome<Row, Types extends LinkTypeDeclaration = LinkTypeDeclaration> =
  | { kind: 'operations'; operations: readonly ConsumerOperation<Row, Types>[] }
  | { kind: 'scope-set'; scope: ScopeID; operations: readonly ConsumerOperation<Row, Types>[] }
  | { kind: 'rejected-fact'; reason: string };

// What the host does with a rejected fact. The consumer stops at the fact, so its offset never
// passes a fact it could not apply, and the owner sees the fact and the reason.
export interface RejectedFactPolicy {
  kind: 'halt-consumer';
}

// The execution contract that a consumer version adds to its declaration. The module's version
// hash binds it to one module boundary and one schema.
export interface ConsumerExecution<Tables extends ConsumerDeclaration['tables']> {
  declaration: ConsumerDeclaration<Tables>;
  version: VersionHash;

  // The fact types the consumer accepts on each stream; any other type passes unread.
  accepts: Readonly<Record<string, readonly string[]>>;

  // The link types the consumer may write.
  linkTypes: readonly string[];
  rejectedFacts: RejectedFactPolicy;
}

// One batch that the host commits in a single transaction: the operations, the consumer's new
// offset and the change log row. All three commit together or not at all.
export interface CommittedBatch<Row> {
  operations: readonly ConsumerOperation<Row>[];
  offset: StreamOffset;
  changeLogBatch: StreamOffset;
}
