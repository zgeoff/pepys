import type { Tagged } from 'type-fest';

export type EntityID = Tagged<string, 'EntityID'>;

export type FactID = Tagged<string, 'FactID'>;

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

export interface EntityViewDeclaration<TableName extends string = string> {
  readonly table: TableName;
  readonly kind: string;
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly actor: string;
  readonly updatedAt: string;
}

export type ConsumerMode = 'fact' | 'scope';

export interface ConsumerDeclaration<
  Tables extends Readonly<Record<string, TableDeclaration>> = Readonly<
    Record<string, TableDeclaration>
  >,
> {
  readonly name: string;
  readonly mode: ConsumerMode;
  readonly streams: readonly string[];
  readonly tables: Tables;
  readonly entityView?: EntityViewDeclaration | undefined;
  readonly reads: readonly string[];
}
