export type EntityIDFailure =
  | { reason: 'malformed' }
  | { reason: 'invalid-source' }
  | { reason: 'reserved-source' }
  | { reason: 'invalid-kind' }
  | { reason: 'empty-id' };
