import type { EntityID, ResyncMark } from '@pepys/kit';
import { collectReturnedEntities } from './collect-returned-entities.ts';
import { collectTiedEntities } from './collect-tied-entities.ts';
import type { LastBody, StoredFactTime } from './collect-tied-entities.ts';

// The entities whose row may be behind the source, which a source's resync pull reads again. The
// pull reads the marks, and removes each one only after its fact is stored, so a failed pull keeps
// it. In memory only, so a restart loses them.
export interface ResyncMarks {
  list: (source: string) => readonly ResyncMark[];

  // A mark set again while the pull ran is a new object, so it stays for the next pull.
  remove: (source: string, mark: ResyncMark) => void;
}

// What the receive route of one source tells the marks.
export interface SourceMarks {
  noteStored: (digest: string, facts: readonly StoredFactTime[]) => void;
  noteCopy: (digest: string, entities: readonly EntityID[]) => void;
}

interface SourceState {
  lastBodies: Map<EntityID, LastBody>;

  marks: Map<EntityID, ResyncMark>;
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
      list: (source) => [...(sources.get(source)?.marks.values() ?? [])],
      remove: (source, mark) => {
        const marks = sources.get(source)?.marks;

        if (marks?.get(mark.entity) === mark) {
          marks.delete(mark.entity);
        }
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

// The locator and digest come from the last body stored for the entity, which the caller has noted
// first.
// Each call makes a new mark object, which `remove` tells apart from the one a pull was given.
function addMarks(
  state: SourceState,
  entities: readonly EntityID[],
  options: ResyncMarksOptions,
): void {
  for (const entity of entities) {
    const last = state.lastBodies.get(entity);

    state.marks.delete(entity);
    state.marks.set(entity, { entity, locator: last?.locator, lastBodyDigest: last?.digest });
  }

  trimToCapacity(state.marks, options.capacity);
}

// drops the oldest entries first: a Map and a Set keep insertion order
function trimToCapacity(
  entries: Map<EntityID, LastBody> | Map<EntityID, ResyncMark>,
  capacity: number,
): void {
  for (const key of entries.keys()) {
    if (entries.size <= capacity) {
      return;
    }

    entries.delete(key);
  }
}
