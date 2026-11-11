import type { EntityIDFailure } from './entity-id-failure.ts';
import type { EntityIDParts } from './entity-id-parts.ts';
import { factKinds } from './fact-kinds.ts';

const partPattern = /^[a-z][a-z0-9_]*$/u;

export function findEntityIDFailure(parts: EntityIDParts): EntityIDFailure | undefined {
  if (!partPattern.test(parts.source)) {
    return { reason: 'invalid-source' };
  }

  if (factKinds.some((factKind) => factKind === parts.source)) {
    return { reason: 'reserved-source' };
  }

  if (!partPattern.test(parts.kind)) {
    return { reason: 'invalid-kind' };
  }

  if (parts.id === '') {
    return { reason: 'empty-id' };
  }

  return undefined;
}
