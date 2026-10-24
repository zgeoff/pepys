import type { ConsumerDeclaration, EntityIDParts, EntityViewDeclaration } from '@pepys/schema';

export interface EntityConsumer {
  consumer: ConsumerDeclaration;
  entityView: EntityViewDeclaration;
}

export function findEntityConsumer(
  consumers: readonly ConsumerDeclaration[],
  parts: EntityIDParts,
): EntityConsumer | undefined {
  for (const consumer of consumers) {
    const entityView = consumer.entityView;

    if (entityView?.kind === parts.kind && isFromSource(consumer, parts.source)) {
      return { consumer, entityView };
    }
  }

  return undefined;
}

function isFromSource(consumer: ConsumerDeclaration, source: string): boolean {
  return consumer.streams.some((stream) => stream.split('.')[1] === source);
}
