import type { EntityID, LinkProblem } from '@pepys/kit';

// Why the test store refused an apply. The kinds from `bad-operation` on are the host's refusals
// of a module's output, which the scope replace case file names.
export type ApplyFailure =
  | { kind: 'refused-facts'; reason: string }
  | { kind: 'entry'; consumer: string; reason: string }

  // output that is no list of operations, or a delete or an unlink from a scope consumer
  | { kind: 'bad-operation'; consumer: string; reason: string }
  | { kind: 'not-owned'; consumer: string; table: string }
  | { kind: 'bad-row'; consumer: string; table: string; reason: string }
  | { kind: 'bad-link'; consumer: string; problem: LinkProblem }
  | { kind: 'duplicate-row'; consumer: string; table: string; key: string }
  | { kind: 'duplicate-link'; consumer: string; key: string }

  // `owner` is null for a link stored with no scope
  | {
      kind: 'scope-conflict';
      consumer: string;
      scope: EntityID;
      table: string;
      key: string;
      owner: EntityID | null;
    };

// A row as the module writes it and as the test store reads it back: booleans as booleans and a
// JSON column as its value.
export type Row = Readonly<Record<string, unknown>>;

export interface WireLink {
  type: string;
  from: string;
  to: string;
  confidence: number;
  evidence: string;
}

// One State Protocol message of the change log. `key` is the JSON text of the key's values: a
// row's primary key columns in order, or a link's type, `from` and `to`.
export interface ChangeEntry {
  type: string;
  key: string;
  value?: unknown;
  old_value?: unknown;
  headers: { operation: 'insert' | 'update' | 'delete' };
}
