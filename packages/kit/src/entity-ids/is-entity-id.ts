import type { EntityID } from '../ids/types.ts';
import { parseEntityID } from './parse-entity-id.ts';

export function isEntityID(text: string): text is EntityID {
  return parseEntityID(text).ok;
}
