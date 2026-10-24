import type { EntityIDFailure } from './entity-id-failure.ts';
import type { EntityIDParts } from './entity-id-parts.ts';
import { findEntityIDFailure } from './find-entity-id-failure.ts';
import type { Result } from './types.ts';

export function parseEntityID(text: string): Result<EntityIDParts, EntityIDFailure> {
  const firstSeparator = text.indexOf(':');
  const secondSeparator = text.indexOf(':', firstSeparator + 1);

  if (firstSeparator === -1 || secondSeparator === -1) {
    return { ok: false, failure: { reason: 'malformed' } };
  }

  const parts = {
    source: text.slice(0, firstSeparator),
    kind: text.slice(firstSeparator + 1, secondSeparator),
    id: text.slice(secondSeparator + 1),
  };

  const failure = findEntityIDFailure(parts);

  if (failure !== undefined) {
    return { ok: false, failure };
  }

  return { ok: true, value: parts };
}
