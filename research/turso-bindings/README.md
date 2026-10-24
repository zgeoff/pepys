# Spike: Turso from TypeScript

The API queries the store through a Kysely dialect over Turso's TypeScript bindings, and attaches
every consumer file read-only. This spike measures the binding's API, read-only attach, and Turso's
full-text and vector search, for the store and search designs.

## Question

What are the method names and result shapes of `@tursodatabase/database`, does read-only attach of
many files work, and how stable are full-text search and vector search?

## Answer

- The spike passes on `@tursodatabase/database` 0.8.3: a Kysely driver maps onto `prepare`, `all`,
  `run` and `iterate`.
- One connection attaches 30 files read-only, but an attached file keeps its attach-time snapshot.
- Every process on a file sets `multiprocess_wal`, and then a direct reader sees the other process's
  commits.
- `fts_score` needs a numbered parameter, and the binding has no approximate index for dense
  vectors.
- `sqlite3` cannot open a file with a full-text index or in MVCC mode.

Read the store through direct connections or a re-attach, not a long-lived attach.

## Run it

```bash
bun run --filter ./research/turso-bindings check
```

The versions and the second process are in [Setup](results.md#setup).

## Results

[results.md](results.md) holds the driver mapping and each feature's full result.

## Untested

rusqlite on a full-text file, 0.9.x, a written Kysely driver, and search at volume:
[Untested](results.md#untested).
