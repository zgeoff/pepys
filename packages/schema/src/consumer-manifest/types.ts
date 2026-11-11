import type { ColumnKind, ConsumerInput, LinkTypeDeclaration, VersionHash } from '@pepys/kit';

// `consumers.json`, as `pepys build` writes it. Each entry is whole, so a kept version needs no file
// but its own entry.
export interface ConsumerBuildManifest {
  readonly kit: 1;

  // null for a plug-in built alone
  readonly deployment: string | null;
  readonly consumers: readonly ListedConsumer[];
}

export interface ConsumerVersion {
  readonly name: string;

  // the SHA-256 of the module's bytes
  readonly module: VersionHash;

  // enrichment champions; `{}` in v1
  readonly pins: Readonly<Record<string, VersionHash>>;

  // The SHA-256 of `module`, `pins` and `manifest` as JSON with sorted keys. The host names the
  // version's folder by it and never computes it.
  readonly version: VersionHash;
  readonly manifest: ConsumerManifest;
}

export interface ListedConsumer extends ConsumerVersion {
  // the module file, relative to `consumers.json`
  readonly path: string;
}

export interface ConsumerManifest {
  readonly name: string;
  readonly input: ConsumerInput;

  // the two symbols that the host calls
  readonly exports: { readonly init: string; readonly apply: string };

  // every read that the host serves the module, with its two symbols
  readonly imports: readonly ManifestRead[];
  readonly tables: Readonly<Record<string, ManifestTable>>;
  readonly links: readonly LinkTypeDeclaration[];

  // the consumer's tables, its indexes and its `entity` view, as the kit's SQL generator writes them
  readonly schema: string;
}

// A `row` read serves a fact consumer one row of its own tables by key. A `scope_facts` read serves a
// scope consumer every fact of the scope's entity.
export type ManifestRead =
  | { readonly kind: 'row'; readonly table: string; readonly length: string; readonly into: string }
  | { readonly kind: 'scope_facts'; readonly length: string; readonly into: string };

export interface ManifestTable {
  readonly columns: Readonly<Record<string, ManifestColumn>>;
  readonly primaryKey: readonly string[];
  readonly indexes: readonly (readonly string[])[];
}

export interface ManifestColumn {
  readonly kind: ColumnKind;
  readonly nullable: boolean;
}
