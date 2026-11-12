import type { Kysely } from 'kysely';
import type { ConsumerDeclaration } from '../consumers/types.ts';
import type { EntityID, StreamName } from '../ids/types.ts';
import type { StoreTables } from '../queries/types.ts';
import type { Result } from '../types.ts';

// One row of the `link` table that the host keeps in each consumer file.
export interface LinkRow {
  type: string;
  from_id: EntityID;
  to_id: EntityID;
  scope: EntityID | null;
  origin: string;
  confidence: number;
  evidence: string;
}

// The two views of every connection. They cover the attached consumers only.
export interface SharedViews {
  // one row per entity of every entity view of every attached consumer
  entity: {
    id: EntityID;
    kind: string;
    title: string;
    url: string | null;
    actor: EntityID | null;
    updated_at: string;
  };

  // every link of every attached consumer
  link_effective: LinkRow;
}

// The host's own tables of a consumer file, reached as `<consumer>.<table>`.
export type HostTables<Consumers extends readonly ConsumerDeclaration[]> = {
  [Name in Consumers[number]['name'] as `${Name}.offsets`]: {
    stream: StreamName;
    last_seq_num: number;
  };
};

export type ConsumersDB<Consumers extends readonly ConsumerDeclaration[]> = StoreTables<Consumers> &
  HostTables<Consumers> &
  SharedViews;

export interface AttachedCall {
  // the version folder each attached consumer was read from, fixed for the whole call
  attached: Readonly<Record<string, { version: string }>>;

  // the `whenCurrent` consumers that had no current version
  skipped: readonly string[];
}

// The work did not run: these consumers have no current version.
export interface StoreReaderFailure {
  reason: 'no-current-version';
  consumers: readonly string[];
}

export interface WithConsumersOptions {
  // More consumers to attach, each only when it has a current version. `db` has no typed table for
  // them, and their rows show in the two shared views.
  whenCurrent?: readonly ConsumerDeclaration[] | undefined;
}

// The port a query reads through. Adapters: Turso in the API, one in-memory database in the
// testing package.
export interface StoreReader {
  // One read-only connection with the current file of each of `consumers` attached, and `work` in
  // one transaction on it.
  withConsumers: <const Consumers extends readonly ConsumerDeclaration[], Value>(
    consumers: Consumers,
    work: (db: Kysely<ConsumersDB<Consumers>>, call: AttachedCall) => Promise<Value>,
    options?: WithConsumersOptions,
  ) => Promise<Result<Value, StoreReaderFailure>>;
  close: () => Promise<void>;
}
