import type { EntityID, FactID } from './ids/types.ts';

export type Result<Value, Failure> = { ok: true; value: Value } | { ok: false; failure: Failure };

export interface FactEnvelope<Payload> {
  id: FactID;
  type: string;
  v: 1;
  api: string;
  entity: EntityID;
  actor?: EntityID | undefined;
  at: string;
  cursor?: string | undefined;
  payload: Payload;
}

// The name of a stream as a declaration writes it. A plain literal fits it, where the branded
// `StreamName` needs a parse.
export type DeclaredStreamName = `facts.${string}.${string}`;

export type ColumnKind =
  | 'text'
  | 'integer'
  | 'real'
  | 'boolean'
  | 'json'
  | 'entityID'
  | 'timestamp';

export interface ColumnDeclaration {
  readonly kind: ColumnKind;
  readonly nullable?: boolean;
}

export interface IndexDeclaration<ColumnName extends string = string> {
  readonly columns: readonly ColumnName[];
}

export interface TableDeclaration<
  Columns extends Readonly<Record<string, ColumnDeclaration>> = Readonly<
    Record<string, ColumnDeclaration>
  >,
> {
  readonly columns: Columns;
  readonly primaryKey: readonly string[];
  readonly indexes: readonly IndexDeclaration[];
}
