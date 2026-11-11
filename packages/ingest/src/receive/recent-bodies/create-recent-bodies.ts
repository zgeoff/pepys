import type { EntityID } from '@pepys/kit';

interface RecentBody {
  stored: number;
  entities: readonly EntityID[];
}

// The bodies one route stored in the last hour, by key. In memory only, so a restart forgets them.
export interface RecentBodies {
  find: (key: string) => RecentBody | undefined;
  remember: (key: string, body: RecentBody) => void;
}

interface RecentBodiesOptions {
  capacity: number;
  maxAgeMs: number;
  now: () => number;
}

interface Entry extends RecentBody {
  atMs: number;
}

export function createRecentBodies(options: RecentBodiesOptions): RecentBodies {
  // a Map keeps insertion order, and an entry is always set anew, so the oldest entry is first
  const entries = new Map<string, Entry>();

  const trimExpired = (): void => {
    const oldestKept = options.now() - options.maxAgeMs;

    for (const [key, entry] of entries) {
      if (entry.atMs > oldestKept && entries.size <= options.capacity) {
        return;
      }

      entries.delete(key);
    }
  };

  return {
    find: (key) => {
      trimExpired();

      const entry = entries.get(key);

      return entry === undefined ? undefined : { stored: entry.stored, entities: entry.entities };
    },
    remember: (key, body) => {
      entries.delete(key);
      entries.set(key, { ...body, atMs: options.now() });

      trimExpired();
    },
  };
}
