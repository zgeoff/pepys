import type {
  BlobHash,
  EntityID,
  FactEnvelope,
  FactID,
  ScopeID,
  StreamOffset,
  VersionHash,
} from '@pepys/kit';
import type { LinkEnds, LinkRegistry } from '../link-registry/link-registry.ts';

export type ConsumerCallInput = FactInput | ScopeInput;

export interface FactInput {
  mode: 'fact';
  offset: StreamOffset;
  fact: FactEnvelope<unknown>;
}

export interface ScopeInput {
  mode: 'scope';
  scope: ScopeID;
}

export type ReadRequest =
  | { row: { table: string; key: string } }
  | { scan: { table: string; index: string; prefix: readonly string[] } }
  | { facts: EntityID }
  | { blob: BlobHash };

export type ReadLimit = { mode: 'fact'; before: StreamOffset } | { mode: 'scope'; scope: ScopeID };

export interface ConsumerReads<Row> {
  findRow: (table: string, key: string) => Row | undefined;
  scanTable: (table: string, index: string, prefix: readonly string[]) => readonly Row[];
  readEntityFacts: (entity: EntityID) => readonly FactEnvelope<unknown>[];
  readBlob: (hash: BlobHash) => Uint8Array | undefined;
}

export type ConsumerLink<Registry extends LinkRegistry> = LinkEnds<Registry> & {
  confidence: number;
  evidence: string;
};

export type FactOperation<Row, Registry extends LinkRegistry> =
  | { upsert: { table: string; row: Row } }
  | { delete: { table: string; key: string } }
  | { link: ConsumerLink<Registry> }
  | { unlink: LinkEnds<Registry> };

export type ScopeOperation<Row, Registry extends LinkRegistry> =
  | { upsert: { table: string; row: Row } }
  | { link: ConsumerLink<Registry> };

export type ConsumerOutcome<Operation> = { applied: readonly Operation[] } | { rejected: string };

export type Halt =
  | { kind: 'rejected-fact'; offset: StreamOffset; fact: FactID; reason: string }
  | { kind: 'rejected-scope'; scope: ScopeID; reason: string }
  | { kind: 'refused-operation'; at: StreamOffset | ScopeID; reason: string };

export type Pins = Readonly<Record<string, VersionHash>>;
