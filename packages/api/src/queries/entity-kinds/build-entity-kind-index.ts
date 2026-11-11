import type { ConsumerDeclaration, EntityKind, EntityViewDeclaration } from '@pepys/kit';

interface EntityOwner {
  consumer: ConsumerDeclaration;
  view: EntityViewDeclaration;
}

// Which consumer and table hold each kind. The deployment check refuses two views of one kind.
export type EntityKindIndex = ReadonlyMap<string, EntityOwner>;

export function buildEntityKindIndex(consumers: readonly ConsumerDeclaration[]): EntityKindIndex {
  return new Map<EntityKind, EntityOwner>(
    consumers.flatMap((consumer) =>
      consumer.entityViews.map((view) => [view.kind, { consumer, view }] as const),
    ),
  );
}
