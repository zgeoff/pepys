import type { EntityID, ResyncMark } from '@pepys/kit';
import { collectReturnedEntities } from './collect-returned-entities.ts';
import { collectTiedEntities } from './collect-tied-entities.ts';
import type { LastBody, StoredFactTime } from './collect-tied-entities.ts';

// The entities whose row may be behind the source, which a source's resync pull reads again. The
// pull reads the marks, and removes each one only after its fact is stored, so a failed pull keeps
// it. In memory only, so a restart loses them.
export interface ResyncMarks {
  list: (source: string) => readonly ResyncMark[];
  remove: (source: string, entity: EntityID) => void;
}

// What the receive route of one source tells the marks.
export interface SourceMarks {
  noteStored: (digest: string, facts: readonly StoredFactTime[]) => void;
  noteCopy: (digest: string, entities: readonly EntityID[]) => void;
}

interface SourceState {
  lastBodies: Map<EntityID, LastBody>;

  // each marked entity, with the locator of the last fact stored for it
  marks: Map<EntityID, string | undefined>;
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

    const state: SourceState = { lastBodies: new Map(), marks: new Map() };

    sources.set(source, state);

    return state;
  };

  return {
    marks: {
      list: (source) =>
        [...(sources.get(source)?.marks ?? [])].map(([entity, locator]) => ({ entity, locator })),
      remove: (source, entity) => {
        sources.get(source)?.marks.delete(entity);
      },
    },
    createSourceMarks: (source) => {
      const state = getState(source);

      return {
        noteStored: (digest, facts) => {
          const tied = collectTiedEntities(state.lastBodies, digest, facts);

          for (const fact of facts) {
            state.lastBodies.delete(fact.entity);
            state.lastBodies.set(fact.entity, { digest, at: fact.at, locator: fact.locator });
          }

          addMarks(state, tied, options);
          trimToCapacity(state.lastBodies, options.capacity);
        },
        noteCopy: (digest, entities) => {
          addMarks(state, collectReturnedEntities(state.lastBodies, digest, entities), options);
        },
      };
    },
  };
}

// The locator comes from the last body stored for the entity, which the caller has noted first.
function addMarks(
  state: SourceState,
  entities: readonly EntityID[],
  options: ResyncMarksOptions,
): void {
  for (const entity of entities) {
    state.marks.delete(entity);
    state.marks.set(entity, state.lastBodies.get(entity)?.locator);
  }

  trimToCapacity(state.marks, options.capacity);
}

// drops the oldest entries first: a Map and a Set keep insertion order
function trimToCapacity(
  entries: Map<EntityID, LastBody> | Map<EntityID, string | undefined>,
  capacity: number,
): void {
  for (const key of entries.keys()) {
    if (entries.size <= capacity) {
      return;
    }

    entries.delete(key);
  }
}
