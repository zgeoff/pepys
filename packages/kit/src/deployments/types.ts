import type { z } from 'zod';
import type { ConsumerDeclaration } from '../consumers/types.ts';
import type { EntityKind, LinkTypeDeclaration } from '../link-types/types.ts';
import type { AnyQueryDefinition } from '../queries/types.ts';
import type { DeliveryCheck, SourceDefinition } from '../sources/types.ts';
import type { DeclaredStreamName } from '../types.ts';

export type SettingValue = string | number | boolean;

export interface Plugin<Query extends AnyQueryDefinition = AnyQueryDefinition> {
  // the kit version the plug-in was declared with
  readonly kit: number;
  readonly name: string;
  readonly settings: PluginSettings | undefined;
  readonly sources: readonly SourceDefinition[];
  readonly consumers: readonly ConsumerDeclaration[];
  readonly queries: readonly Query[];

  // every consumer's `links`, once per name
  readonly linkTypes: readonly LinkTypeDeclaration[];

  // every family's `entityKind` and every entity view's `kind`, once each
  readonly entityKinds: readonly EntityKind[];
}

// Compile-time settings: `pepys build` writes the checked values into the glue of each consumer of
// the plug-in, so a consumer reads no setting at run time and a new value is a new version.
export interface PluginSettings<Schema extends z.ZodObject = z.ZodObject> {
  // a flat object of strings, numbers and booleans
  readonly schema: Schema;
  readonly defaults: z.output<Schema>;
}

export interface Deployment<Plugins extends readonly Plugin[] = readonly Plugin[]> {
  readonly name: string;
  readonly plugins: Plugins;

  // Literals by plug-in name: the deployment file reads no environment. A value left out takes the
  // plug-in's default.
  readonly settings?: Readonly<Record<string, Readonly<Record<string, SettingValue>>>> | undefined;
}

// The typed client of one plug-in's queries. A type only, so the kit needs no oRPC. A plug-in with
// no queries, written inside `defineDeployment`, takes its query type from the call's context, so
// a query name that is no literal gives no method rather than an index signature.
export type PluginClient<Target extends Plugin> = {
  [Query in Target['queries'][number] as string extends Query['name'] ? never : Query['name']]: (
    input: z.input<Query['input']>,
  ) => Promise<z.output<Query['output']>>;
};

export interface CheckedDeployment {
  readonly name: string;
  readonly sources: readonly SourceDefinition[];
  readonly consumers: readonly ConsumerDeclaration[];
  readonly queries: readonly AnyQueryDefinition[];
  readonly entityKinds: readonly EntityKind[];
  readonly linkTypes: readonly LinkTypeDeclaration[];

  // the checked settings of each plug-in that declares some, with the defaults filled in
  readonly settings: Readonly<Record<string, Readonly<Record<string, SettingValue>>>>;
}

export type DuplicateOf =
  | 'plugin'
  | 'source'
  | 'stream'
  | 'route'
  | 'fact-type'
  | 'consumer'
  | 'table'
  | 'query'
  | 'link-type'
  | 'entity-view-kind';

export type DeploymentFailure =
  | { kind: 'kit-version'; plugin: string; kit: number }

  // `link-type`: one name with two shapes. `entity-view-kind`: a kind needs one owning table.
  | { kind: 'duplicate'; of: DuplicateOf; name: string; plugins: readonly string[] }

  // a link end or a scope kind that no plug-in of the deployment brings
  | { kind: 'unknown-entity-kind'; entityKind: EntityKind; plugin: string; usedBy: string }
  | { kind: 'missing-consumer'; consumer: string; query: string }
  | { kind: 'missing-stream'; stream: DeclaredStreamName; consumer: string }
  | { kind: 'reserved-query-name'; query: string }
  | { kind: 'reserved-table-name'; table: string; consumer: string }
  | { kind: 'scope-reads'; consumer: string }
  | { kind: 'reserved-source-name'; source: string }

  // a value that fails the schema, or settings for a plug-in that has none or is not deployed
  | { kind: 'invalid-settings'; plugin: string; issues: readonly string[] }

  // a read or an entity view that names a table the consumer does not declare
  | { kind: 'unknown-table'; consumer: string; table: string; usedBy: 'reads' | 'entity-view' }
  | {
      kind: 'unknown-column';
      consumer: string;
      table: string;
      column: string;
      usedBy: 'primary-key' | 'index' | 'entity-view';
    };

export interface ReceiveRoute {
  source: string;
  route: string;
  check: DeliveryCheck['kind'];
  reach: 'public' | 'private';

  // false for a route that answers and stores nothing
  stores: boolean;
}
