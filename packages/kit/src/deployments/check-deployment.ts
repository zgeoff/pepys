import { hostTableNames, kitVersion } from '../constants.ts';
import type { ConsumerDeclaration } from '../consumers/types.ts';
import { factKinds } from '../entity-ids/fact-kinds.ts';
import { collectCoercedFields } from '../generators/collect-coerced-fields.ts';
import type { EntityKind, LinkTypeDeclaration } from '../link-types/types.ts';
import type { FactFamily, SourceDefinition } from '../sources/types.ts';
import type { Result, TableDeclaration } from '../types.ts';
import type {
  CheckedDeployment,
  Deployment,
  DeploymentFailure,
  DuplicateOf,
  Plugin,
  SettingValue,
} from './types.ts';

export function checkDeployment(
  deployment: Deployment,
): Result<CheckedDeployment, readonly DeploymentFailure[]> {
  const parts = collectParts(deployment.plugins);
  const settings = collectSettings(deployment);

  const failures = [
    ...collectKitFailures(deployment.plugins),
    ...collectDuplicates(deployment.plugins, parts),
    ...collectReservedNames(deployment.plugins, parts),
    ...collectCoercedFieldFailures(parts),
    ...collectConsumerFailures(deployment.plugins, parts),
    ...collectMissingConsumers(deployment.plugins, parts),
    ...settings.failures,
  ];

  if (failures.length > 0) {
    return { ok: false, failure: failures };
  }

  return {
    ok: true,
    value: {
      name: deployment.name,
      sources: parts.sources.map((owned) => owned.item),
      consumers: parts.consumers.map((owned) => owned.item),
      queries: deployment.plugins.flatMap((plugin) => plugin.queries),
      entityKinds: [...new Set(deployment.plugins.flatMap((plugin) => plugin.entityKinds))],
      linkTypes: collectUniqueLinkTypes(deployment.plugins),
      settings: settings.values,
    },
  };
}

// An item of the deployment with the name of the plug-in that brings it.
interface Owned<Item> {
  plugin: string;
  item: Item;
}

interface DeploymentParts {
  sources: Owned<SourceDefinition>[];
  families: Owned<FactFamily>[];
  consumers: Owned<ConsumerDeclaration>[];
}

function collectParts(plugins: readonly Plugin[]): DeploymentParts {
  const parts: DeploymentParts = { sources: [], families: [], consumers: [] };

  for (const plugin of plugins) {
    for (const source of plugin.sources) {
      parts.sources.push({ plugin: plugin.name, item: source });

      for (const family of source.families) {
        parts.families.push({ plugin: plugin.name, item: family });
      }
    }

    for (const consumer of plugin.consumers) {
      parts.consumers.push({ plugin: plugin.name, item: consumer });
    }
  }

  return parts;
}

type SettingValues = Record<string, Record<string, SettingValue>>;

function collectSettings(deployment: Deployment): {
  values: SettingValues;
  failures: DeploymentFailure[];
} {
  const given = deployment.settings ?? {};
  const values: SettingValues = {};
  const failures: DeploymentFailure[] = [];

  for (const name of Object.keys(given)) {
    const plugin = deployment.plugins.find((candidate) => candidate.name === name);

    if (plugin === undefined) {
      failures.push(buildSettingsFailure(name, 'the deployment has no plug-in of this name'));
    } else if (plugin.settings === undefined) {
      failures.push(buildSettingsFailure(name, 'the plug-in declares no settings'));
    }
  }

  for (const plugin of deployment.plugins) {
    if (plugin.settings === undefined) {
      continue;
    }

    const parsed = plugin.settings.schema.safeParse({
      ...plugin.settings.defaults,
      ...given[plugin.name],
    });

    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      );

      failures.push({ kind: 'invalid-settings', plugin: plugin.name, issues });
      continue;
    }

    const entries = Object.entries(parsed.data);

    const flat = entries.filter((entry): entry is [string, SettingValue] =>
      isSettingValue(entry[1]),
    );

    if (flat.length < entries.length) {
      failures.push(
        buildSettingsFailure(plugin.name, 'a setting must be a string, a number or a boolean'),
      );

      continue;
    }

    values[plugin.name] = Object.fromEntries(flat);
  }

  return { values, failures };
}

function buildSettingsFailure(plugin: string, issue: string): DeploymentFailure {
  return { kind: 'invalid-settings', plugin, issues: [issue] };
}

function isSettingValue(value: unknown): value is SettingValue {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function collectKitFailures(plugins: readonly Plugin[]): DeploymentFailure[] {
  return plugins
    .filter((plugin) => plugin.kit !== kitVersion)
    .map((plugin) => ({ kind: 'kit-version', plugin: plugin.name, kit: plugin.kit }));
}

interface Named {
  name: string;
  plugin: string;
}

function collectDuplicates(
  plugins: readonly Plugin[],
  parts: DeploymentParts,
): DeploymentFailure[] {
  const names: Record<DuplicateOf, Named[]> = {
    plugin: plugins.map((plugin) => ({ name: plugin.name, plugin: plugin.name })),
    source: parts.sources.map((owned) => ({ name: owned.item.name, plugin: owned.plugin })),
    stream: parts.families.map((owned) => ({ name: owned.item.stream, plugin: owned.plugin })),
    route: [],
    'fact-type': [],
    consumer: parts.consumers.map((owned) => ({ name: owned.item.name, plugin: owned.plugin })),
    table: [],
    query: [],
    'link-type': collectLinkTypeShapes(parts.consumers),
    'entity-view-kind': [],
  };

  for (const owned of parts.sources) {
    const path = owned.item.live;

    if (path?.kind === 'receive') {
      for (const route of [path.route, ...(path.ignoredRoutes ?? [])]) {
        names.route.push({ name: route, plugin: owned.plugin });
      }
    }
  }

  for (const owned of parts.families) {
    for (const type of Object.keys(owned.item.types)) {
      names['fact-type'].push({ name: type, plugin: owned.plugin });
    }
  }

  for (const owned of parts.consumers) {
    for (const table of Object.keys(owned.item.tables)) {
      names.table.push({ name: table, plugin: owned.plugin });
    }

    for (const view of owned.item.entityViews) {
      names['entity-view-kind'].push({ name: view.kind, plugin: owned.plugin });
    }
  }

  for (const plugin of plugins) {
    for (const query of plugin.queries) {
      names.query.push({ name: query.name, plugin: plugin.name });
    }
  }

  const failures: DeploymentFailure[] = [];

  for (const [of, entries] of Object.entries(names)) {
    failures.push(...collectRepeatedNames(of, entries));
  }

  return failures;
}

// One entry per distinct shape of a name, so a link type that two consumers share counts once.
function collectLinkTypeShapes(consumers: readonly Owned<ConsumerDeclaration>[]): Named[] {
  const shapes = new Map<string, Named>();

  for (const owned of consumers) {
    for (const linkType of owned.item.links) {
      const shape = JSON.stringify([linkType.name, linkType.from, linkType.to, linkType.hub]);

      if (!shapes.has(shape)) {
        shapes.set(shape, { name: linkType.name, plugin: owned.plugin });
      }
    }
  }

  return [...shapes.values()];
}

function collectRepeatedNames(of: string, entries: readonly Named[]): DeploymentFailure[] {
  const failures: DeploymentFailure[] = [];

  for (const [name, group] of Map.groupBy(entries, (entry) => entry.name)) {
    if (group.length > 1 && isDuplicateOf(of)) {
      failures.push({ kind: 'duplicate', of, name, plugins: group.map((entry) => entry.plugin) });
    }
  }

  return failures;
}

const duplicateOfValues: ReadonlySet<string> = new Set<DuplicateOf>([
  'plugin',
  'source',
  'stream',
  'route',
  'fact-type',
  'consumer',
  'table',
  'query',
  'link-type',
  'entity-view-kind',
]);

function isDuplicateOf(text: string): text is DuplicateOf {
  return duplicateOfValues.has(text);
}

const coreQueryNames: ReadonlySet<string> = new Set(['get_entity', 'neighbourhood']);
const reservedTableNames: ReadonlySet<string> = new Set(hostTableNames);

function collectReservedNames(
  plugins: readonly Plugin[],
  parts: DeploymentParts,
): DeploymentFailure[] {
  const failures: DeploymentFailure[] = [];

  const reservedSources: ReadonlySet<string> = new Set(factKinds);

  for (const owned of parts.sources) {
    if (reservedSources.has(owned.item.name)) {
      failures.push({ kind: 'reserved-source-name', source: owned.item.name });
    }
  }

  for (const query of plugins.flatMap((plugin) => plugin.queries)) {
    if (coreQueryNames.has(query.name)) {
      failures.push({ kind: 'reserved-query-name', query: query.name });
    }
  }

  for (const owned of parts.consumers) {
    for (const table of Object.keys(owned.item.tables)) {
      if (reservedTableNames.has(table)) {
        failures.push({ kind: 'reserved-table-name', table, consumer: owned.item.name });
      }
    }
  }

  return failures;
}

function collectCoercedFieldFailures(parts: DeploymentParts): DeploymentFailure[] {
  return parts.sources.flatMap((owned) =>
    owned.item.families
      .flatMap((family) => Object.entries(family.types))
      .flatMap(([factType, schema]) =>
        collectCoercedFields(schema, '').map((field) => ({
          kind: 'coerced-payload-field' as const,
          source: owned.item.name,
          factType,
          field,
        })),
      ),
  );
}

function collectConsumerFailures(
  plugins: readonly Plugin[],
  parts: DeploymentParts,
): DeploymentFailure[] {
  const streams: ReadonlySet<string> = new Set(parts.families.map((owned) => owned.item.stream));
  const kinds: ReadonlySet<string> = new Set(plugins.flatMap((plugin) => plugin.entityKinds));

  const failures: DeploymentFailure[] = [];

  for (const owned of parts.consumers) {
    const consumer = owned.item;

    if (consumer.input.mode === 'scope' && consumer.reads.length > 0) {
      failures.push({ kind: 'scope-reads', consumer: consumer.name });
    }

    for (const stream of consumer.input.streams.filter((name) => !streams.has(name))) {
      failures.push({ kind: 'missing-stream', stream, consumer: consumer.name });
    }

    for (const use of collectKindUses(consumer)) {
      if (!kinds.has(use.entityKind)) {
        failures.push({ kind: 'unknown-entity-kind', ...use, plugin: owned.plugin });
      }
    }

    failures.push(...collectTableFailures(consumer));
  }

  return failures;
}

interface KindUse {
  entityKind: EntityKind;
  usedBy: string;
}

function collectKindUses(consumer: ConsumerDeclaration): KindUse[] {
  const uses = new Map<string, KindUse>();

  const addUse = (entityKind: EntityKind, usedBy: string): void => {
    uses.set(`${entityKind}\n${usedBy}`, { entityKind, usedBy });
  };

  if (consumer.input.mode === 'scope') {
    addUse(consumer.input.scopeKind, consumer.name);
  }

  for (const linkType of consumer.links) {
    for (const entityKind of [...linkType.from, ...linkType.to]) {
      addUse(entityKind, linkType.name);
    }
  }

  return [...uses.values()];
}

function collectTableFailures(consumer: ConsumerDeclaration): DeploymentFailure[] {
  const failures: DeploymentFailure[] = [];

  const addUnknownColumns = (
    table: string,
    columns: readonly string[],
    usedBy: 'primary-key' | 'index' | 'entity-view',
  ): void => {
    const declared = consumer.tables[table]?.columns ?? {};

    for (const column of columns.filter((name) => !Object.hasOwn(declared, name))) {
      failures.push({ kind: 'unknown-column', consumer: consumer.name, table, column, usedBy });
    }
  };

  for (const [table, declaration] of Object.entries(consumer.tables)) {
    addUnknownColumns(table, declaration.primaryKey, 'primary-key');

    for (const column of declaration.primaryKey) {
      if (declaration.columns[column]?.nullable === true) {
        failures.push({ kind: 'nullable-key-column', consumer: consumer.name, table, column });
      }
    }

    addUnknownColumns(
      table,
      declaration.indexes.flatMap((index) => index.columns),
      'index',
    );
  }

  for (const table of consumer.reads.filter((name) => !Object.hasOwn(consumer.tables, name))) {
    failures.push({ kind: 'unknown-table', consumer: consumer.name, table, usedBy: 'reads' });
  }

  for (const table of consumer.reads.filter((name) => Object.hasOwn(consumer.tables, name))) {
    const declaration = consumer.tables[table];

    for (const column of declaration?.primaryKey ?? []) {
      if (declaration?.columns[column]?.kind === 'json') {
        failures.push({ kind: 'json-key-read', consumer: consumer.name, table, column });
      }
    }
  }

  for (const view of consumer.entityViews) {
    const aliasTable = `${view.table}_alias`;
    const aliases = consumer.tables[aliasTable];

    if (aliases !== undefined && !isAliasTable(aliases)) {
      failures.push({ kind: 'alias-table-shape', consumer: consumer.name, table: aliasTable });
    }

    const declared = consumer.tables[view.table]?.columns;

    if (declared === undefined) {
      failures.push({
        kind: 'unknown-table',
        consumer: consumer.name,
        table: view.table,
        usedBy: 'entity-view',
      });
    } else {
      const columns = [view.id, view.title, view.url, view.actor, view.updatedAt, view.deletedAt];

      addUnknownColumns(
        view.table,
        columns.filter((column) => column !== null && column !== undefined),
        'entity-view',
      );

      const deleted = view.deletedAt === undefined ? undefined : declared[view.deletedAt];

      if (
        view.deletedAt !== undefined &&
        deleted !== undefined &&
        (deleted.kind !== 'timestamp' || deleted.nullable !== true)
      ) {
        failures.push({
          kind: 'entity-view-column-kind',
          consumer: consumer.name,
          table: view.table,
          view: view.kind,
          column: view.deletedAt,
          usedAs: 'deletedAt',
        });
      }

      const idColumns = [
        ['id', view.id],
        ['actor', view.actor],
      ] as const;

      for (const [usedAs, column] of idColumns) {
        if (column === null) {
          continue;
        }

        const columnKind = declared[column]?.kind;

        if (columnKind !== undefined && columnKind !== 'entityID') {
          failures.push({
            kind: 'entity-view-column-kind',
            consumer: consumer.name,
            table: view.table,
            view: view.kind,
            column,
            usedAs,
          });
        }
      }
    }
  }

  return failures;
}

function isAliasTable(table: TableDeclaration): boolean {
  const { alias, entity_id: entityID, updated_at: updatedAt, ...others } = table.columns;

  return (
    alias?.kind === 'text' &&
    alias.nullable !== true &&
    entityID?.kind === 'entityID' &&
    entityID.nullable !== true &&
    updatedAt?.kind === 'timestamp' &&
    updatedAt.nullable !== true &&
    Object.keys(others).length === 0 &&
    table.primaryKey.length === 1 &&
    table.primaryKey[0] === 'alias'
  );
}

function collectMissingConsumers(
  plugins: readonly Plugin[],
  parts: DeploymentParts,
): DeploymentFailure[] {
  const names: ReadonlySet<string> = new Set(parts.consumers.map((owned) => owned.item.name));

  const failures: DeploymentFailure[] = [];

  for (const plugin of plugins) {
    for (const query of plugin.queries) {
      for (const consumer of query.reads.filter((read) => !names.has(read.name))) {
        failures.push({ kind: 'missing-consumer', consumer: consumer.name, query: query.name });
      }
    }
  }

  return failures;
}

function collectUniqueLinkTypes(plugins: readonly Plugin[]): LinkTypeDeclaration[] {
  const byName = new Map<string, LinkTypeDeclaration>();

  for (const linkType of plugins.flatMap((plugin) => plugin.linkTypes)) {
    if (!byName.has(linkType.name)) {
      byName.set(linkType.name, linkType);
    }
  }

  return [...byName.values()];
}
