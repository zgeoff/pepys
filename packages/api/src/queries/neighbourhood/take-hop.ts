import type { EntityID, LinkRow } from '@pepys/kit';
import { compareText } from './compare-text.ts';

interface WalkLink {
  type: string;
  from: EntityID;
  to: EntityID;
  direction: 'outgoing' | 'incoming';
  origin: string;
  confidence: number;
  depth: number;
}

export interface WalkState {
  // every ID seen, with the depth it was first seen at; the cycle guard
  depths: ReadonlyMap<EntityID, number>;
  links: readonly WalkLink[];

  // the IDs the next hop expands
  frontier: readonly EntityID[];
  isTruncated: boolean;
}

interface Hop {
  depth: number;
  entityLimit: number;
  linkReadLimit: number;
}

// One hop, from the link rows that touch the frontier in read order. Two origins of one link merge
// at the highest confidence; new IDs join in ID order while the entity limit has room.
export function takeHop(state: WalkState, rows: readonly LinkRow[], hop: Hop): WalkState {
  const frontier = new Set(state.frontier);
  const followed = new Set(state.links.map((link) => toLinkKey(link.type, link.from, link.to)));
  const merged = new Map<string, LinkRow>();

  for (const row of rows.slice(0, hop.linkReadLimit)) {
    const key = toLinkKey(row.type, row.from_id, row.to_id);
    const held = merged.get(key);

    if (!followed.has(key) && (held === undefined || row.confidence > held.confidence)) {
      merged.set(key, row);
    }
  }

  const candidates = [...merged.values()].map((row) => {
    const isOutgoing = frontier.has(row.from_id);

    return {
      link: {
        type: row.type,
        from: row.from_id,
        to: row.to_id,
        direction: isOutgoing ? 'outgoing' : 'incoming',
        origin: row.origin,
        confidence: row.confidence,
        depth: hop.depth,
      } satisfies WalkLink,
      reached: isOutgoing ? row.to_id : row.from_id,
    };
  });

  const newIDs = [
    ...new Set(
      candidates.map((candidate) => candidate.reached).filter((id) => !state.depths.has(id)),
    ),
  ].toSorted();

  const room = Math.max(0, hop.entityLimit - state.depths.size);
  const admitted = newIDs.slice(0, room);

  const depths = new Map([...state.depths, ...admitted.map((id) => [id, hop.depth] as const)]);

  const links = candidates
    .filter((candidate) => depths.has(candidate.reached))
    .map((candidate) => candidate.link)
    .toSorted(compareLinks);

  return {
    depths,
    links: [...state.links, ...links],
    frontier: admitted,
    isTruncated: state.isTruncated || rows.length > hop.linkReadLimit || newIDs.length > room,
  };
}

function toLinkKey(type: string, from: EntityID, to: EntityID): string {
  return JSON.stringify([type, from, to]);
}

function compareLinks(first: WalkLink, second: WalkLink): number {
  return (
    compareText(first.type, second.type) ||
    compareText(first.from, second.from) ||
    compareText(first.to, second.to)
  );
}
