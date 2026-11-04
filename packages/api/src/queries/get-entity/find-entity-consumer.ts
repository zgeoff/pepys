import { parseStreamName } from '@pepys/schema';
import type { ConsumerDeclaration, EntityIDParts, EntityViewDeclaration } from '@pepys/schema';
import invariant from 'tiny-invariant';

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
  return consumer.streams.some((stream) => {
    const parsed = parseStreamName(stream);

    invariant(parsed.ok, `${consumer.name} declares a stream named facts.<source>.<family>`);

    return parsed.value.source === source;
  });
}
