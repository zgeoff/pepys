import type { ChangeEntry, Row, WireLink } from '../utils/types.ts';

export interface KeyedRow {
  table: string;
  key: string;
  row: Row;
}

// What one scope returned, checked and keyed.
export interface ScopeResult {
  rows: readonly KeyedRow[];
  links: readonly WireLink[];
}

export interface StoredLink {
  scope: string | null;
  link: WireLink;
}

// What the consumer's store holds that the replace of one scope needs. Rows and owners are keyed by
// `buildRowID`, links by the JSON text of their key.
export interface ScopeState {
  // the scope of each row that a scope owns
  rowOwners: ReadonlyMap<string, string>;

  // the stored row of each key that the result names or that the scope owns
  storedRows: ReadonlyMap<string, Row>;

  // every link of the consumer
  storedLinks: ReadonlyMap<string, StoredLink>;
}

export interface ScopeChanges {
  writtenRows: readonly KeyedRow[];
  writtenLinks: readonly WireLink[];
  deletedRows: readonly Omit<KeyedRow, 'row'>[];
  deletedLinks: readonly WireLink[];
  entries: readonly ChangeEntry[];
}
