import type { EntityKind, LinkTypeDeclaration } from '../link-types/types.ts';
import type { DeclaredStreamName, TableDeclaration } from '../types.ts';

// The same shape in the declaration and in the consumer manifest, so the build copies it whole.
export type ConsumerInput =
  | { readonly mode: 'fact'; readonly streams: readonly DeclaredStreamName[] }

  // A fact on one of `streams` whose entity is of `scopeKind` marks that entity's scope dirty.
  | {
      readonly mode: 'scope';
      readonly scopeKind: EntityKind;
      readonly streams: readonly DeclaredStreamName[];
    };

export interface EntityViewDeclaration<TableName extends string = string> {
  readonly table: TableName;
  readonly kind: EntityKind;
  readonly id: string;
  readonly title: string;
  readonly url: string | null;
  readonly actor: string | null;
  readonly updatedAt: string;

  // a nullable timestamp column; a row with a time in it is left out of the view
  readonly deletedAt?: string;
}

// The entry file is a scriptc library with the model contract: it exports a model type, a message
// type, `init` and `update`, beside the consumer's own export. scriptc attests no other shape.
export interface ConsumerDeclaration<
  Name extends string = string,
  Tables extends Readonly<Record<string, TableDeclaration>> = Readonly<
    Record<string, TableDeclaration>
  >,
  LinkType extends LinkTypeDeclaration = LinkTypeDeclaration,
> {
  readonly name: Name;
  readonly entry: URL;
  readonly input: ConsumerInput;
  readonly tables: Tables;

  // One view per table whose rows are entities. `defineConsumer` keeps the table names to the
  // consumer's own; a key type here would make a declaration fit no wider consumer type.
  readonly entityViews: readonly EntityViewDeclaration[];

  // own tables whose rows the module reads by key; fact mode only
  readonly reads: readonly string[];

  // the link types the consumer may write
  readonly links: readonly LinkType[];
}
