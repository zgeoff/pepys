import type { ConsumerDeclaration } from '../consumers/types.ts';
import type { EntityKind } from '../link-types/types.ts';
import type { FactFamily } from '../sources/types.ts';
import { formatEntityIDs } from './format-entity-ids.ts';
import { formatFactReader } from './format-fact-reader.ts';
import { formatModelContract } from './format-model-contract.ts';
import { formatOperations } from './format-operations.ts';
import { formatRowReaders } from './format-row-readers.ts';
import { toPascalCase } from './to-pascal-case.ts';

export interface BoundaryGlueParameters {
  consumer: ConsumerDeclaration;

  // The families of the deployment. The glue types the facts of those on the consumer's streams.
  families: readonly FactFamily[];

  // the plug-in's checked settings, or undefined when it declares none
  settings: Readonly<Record<string, string | number | boolean>> | undefined;
}

// The one file that a consumer's entry imports: entity IDs, the settings, the model contract, the
// facts it reads, its rows and its operations. The glue reads a row of the consumer's own tables
// only, and runs no zod.
export function generateBoundaryGlue(parameters: BoundaryGlueParameters): string {
  const consumer = parameters.consumer;
  const consumerName = toPascalCase(consumer.name);

  const streams = new Set<string>(consumer.input.streams);

  const families = parameters.families.filter((family) => streams.has(family.stream));

  const sections = [
    ...formatEntityIDs(collectEntityKinds(consumer, families)),
    ...(parameters.settings === undefined ? [] : [formatSettings(parameters.settings)]),
    formatModelContract(consumerName),
    ...formatFactReader({ consumerName, input: consumer.input, families }),
    ...formatOperations(consumer),
    ...formatRowReaders(consumer),
  ];

  return `${sections.join('\n\n')}\n`;
}

function collectEntityKinds(
  consumer: ConsumerDeclaration,
  families: readonly FactFamily[],
): EntityKind[] {
  const kinds = new Set<EntityKind>([
    ...(consumer.input.mode === 'scope' ? [consumer.input.scopeKind] : []),
    ...families.map((family) => family.entityKind),
    ...consumer.entityViews.map((view) => view.kind),
    ...consumer.links.flatMap((link) => [...link.from, ...link.to]),
  ]);

  return [...kinds].toSorted();
}

function formatSettings(settings: Readonly<Record<string, string | number | boolean>>): string {
  return `export const settings = ${JSON.stringify(settings, null, 2)} as const;`;
}
