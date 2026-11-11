import { kitVersion } from '../constants.ts';
import type { ConsumerDeclaration } from '../consumers/types.ts';
import type { EntityKind, LinkTypeDeclaration } from '../link-types/types.ts';
import type { AnyQueryDefinition } from '../queries/types.ts';
import type { SourceDefinition } from '../sources/types.ts';
import type { Plugin, PluginSettings } from './types.ts';

interface PluginDeclaration<Query extends AnyQueryDefinition> {
  readonly name: string;
  readonly sources?: readonly SourceDefinition[] | undefined;
  readonly consumers?: readonly ConsumerDeclaration[] | undefined;
  readonly queries?: readonly Query[] | undefined;
  readonly settings?: PluginSettings | undefined;
}

export function definePlugin<const Query extends AnyQueryDefinition = never>(
  plugin: PluginDeclaration<Query>,
): Plugin<Query> {
  const sources = plugin.sources ?? [];
  const consumers = plugin.consumers ?? [];

  return {
    kit: kitVersion,
    name: plugin.name,
    settings: plugin.settings,
    sources,
    consumers,
    queries: plugin.queries ?? [],
    linkTypes: collectLinkTypes(consumers),
    entityKinds: collectEntityKinds(sources, consumers),
  };
}

function collectLinkTypes(consumers: readonly ConsumerDeclaration[]): LinkTypeDeclaration[] {
  const byName = new Map<string, LinkTypeDeclaration>();

  for (const linkType of consumers.flatMap((consumer) => consumer.links)) {
    if (!byName.has(linkType.name)) {
      byName.set(linkType.name, linkType);
    }
  }

  return [...byName.values()];
}

function collectEntityKinds(
  sources: readonly SourceDefinition[],
  consumers: readonly ConsumerDeclaration[],
): EntityKind[] {
  const kinds = [
    ...sources.flatMap((source) => source.families.map((family) => family.entityKind)),
    ...consumers.flatMap((consumer) => consumer.entityViews.map((view) => view.kind)),
  ];

  return [...new Set(kinds)];
}
