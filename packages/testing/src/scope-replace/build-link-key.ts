import type { WireLink } from '../utils/types.ts';

// The key of a link in the change log: the JSON text of its type and its two ends.
export function buildLinkKey(link: Pick<WireLink, 'type' | 'from' | 'to'>): string {
  return JSON.stringify([link.type, link.from, link.to]);
}
