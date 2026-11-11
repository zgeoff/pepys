import type { ConsumerDeclaration } from '../consumers/types.ts';
import type { EntityKind } from '../link-types/types.ts';

// The ID column of an entity view holds IDs of the view's kind, keyed `<table>.<column>`. Any other
// entityID column holds an ID of any kind, because a column declares no kind.
export function collectViewKinds(consumer: ConsumerDeclaration): ReadonlyMap<string, EntityKind> {
  return new Map(consumer.entityViews.map((view) => [`${view.table}.${view.id}`, view.kind]));
}
