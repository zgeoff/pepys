import type { ConsumerDeclaration, EntityIDParts, EntityViewDeclaration } from '@pepys/kit';

export interface EntityConsumer {
  consumer: ConsumerDeclaration;
  entityView: EntityViewDeclaration;
}

export function findEntityConsumer(
  consumers: readonly ConsumerDeclaration[],
  parts: EntityIDParts,
): EntityConsumer | undefined {
  const kind = `${parts.source}:${parts.kind}`;

  for (const consumer of consumers) {
    const entityView = consumer.entityViews.find((view) => view.kind === kind);

    if (entityView !== undefined) {
      return { consumer, entityView };
    }
  }

  return undefined;
}
