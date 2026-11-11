import type { EntityID } from '@pepys/kit';
import { collectReturnedEntities } from './collect-returned-entities.ts';
import { collectTiedEntities } from './collect-tied-entities.ts';
import type { LastBody } from './collect-tied-entities.ts';

// The entities whose row may be behind the source, which a source's resync pull reads again. The
// pull reads the marks, and removes each one only after its fact is stored, so a failed pull keeps
// it. In memory only, so a restart loses them.
export interface ResyncMarks {
  list: (source: string) => readonly EntityID[];
  remove: (source: string, entity: EntityID) => void;
}

// What the receive route of one source tells the marks.
export interface SourceMarks {
  noteStored: (digest: string, facts: readonly { entity: EntityID; at: string }[]) => void;
  noteCopy: (digest: string, entities: readonly EntityID[]) => void;
}

interface SourceState {
  lastBodies: Map<EntityID, LastBody>;
  marks: Set<EntityID>;
}

export interface ResyncMarkStore {
  marks: ResyncMarks;
  createSourceMarks: (source: string) => SourceMarks;
}

// `capacity` bounds the marks and the last bodies of each source; the oldest go first
interface ResyncMarksOptions {
  capacity: number;
}

export function createResyncMarks(options: ResyncMarksOptions): ResyncMarkStore {
  const sources = new Map<string, SourceState>();

  const getState = (source: string): SourceState => {
    const known = sources.get(source);

    if (known !== undefined) {
      return known;
    }

    const state: SourceState = { lastBodies: new Map(), marks: new Set() };

    sources.set(source, state);

    return state;
  };

  return {
    marks: {
      list: (source) => [...(sources.get(source)?.marks ?? [])],
      remove: (source, entity) => {
        sources.get(source)?.marks.delete(entity);
      },
    },
    createSourceMarks: (source) => {
      const state = getState(source);

      return {
        noteStored: (digest, facts) => {
          addMarks(state.marks, collectTiedEntities(state.lastBodies, digest, facts), options);

          for (const fact of facts) {
            state.lastBodies.delete(fact.entity);
            state.lastBodies.set(fact.entity, { digest, at: fact.at });
          }

          trimToCapacity(state.lastBodies, options.capacity);
        },
        noteCopy: (digest, entities) => {
          addMarks(
            state.marks,
            collectReturnedEntities(state.lastBodies, digest, entities),
            options,
          );
        },
      };
    },
  };
}

function addMarks(
  marks: Set<EntityID>,
  entities: readonly EntityID[],
  options: ResyncMarksOptions,
): void {
  for (const entity of entities) {
    marks.add(entity);
  }

  trimToCapacity(marks, options.capacity);
}

// drops the oldest entries first: a Map and a Set keep insertion order
function trimToCapacity(entries: Map<EntityID, LastBody> | Set<EntityID>, capacity: number): void {
  for (const key of entries.keys()) {
    if (entries.size <= capacity) {
      return;
    }

    entries.delete(key);
  }
}
