import type { LinkRow, SharedViews } from '@pepys/kit';
import type { Kysely } from 'kysely';

// The tables that the test store keeps beside the consumers' own. The host keeps `link` and
// `scope_row` in each consumer's file; one database holds every consumer here, so both carry the
// consumer's name.
export interface StoreTables extends SharedViews {
  link: LinkRow;
  scope_row: { consumer: string; table_name: string; key: string; scope: string };
}

export type StoreDatabase = Kysely<StoreTables>;
