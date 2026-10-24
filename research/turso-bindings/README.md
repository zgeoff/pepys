# Turso from TypeScript

The API queries the store through a Kysely dialect over Turso's TypeScript bindings, and attaches
every consumer file read-only. Search uses Turso's full-text and vector features. This spike checks
those parts before the API package.

## Question

What are the method names and result shapes of `@tursodatabase/database`, does read-only attach of
many files work, and how stable are full-text search and vector search?

## Method

1. Open a Turso file from Bun and run a prepared select, an insert and an iterate over rows.
2. Create 30 consumer files, attach them all read-only to one connection, and union a view across
   them.
3. Write to one file from a second process while the first reads it.
4. Build a full-text index and a vector table, and query both.
5. Check whether turning multi-version concurrency control on changes the file format.

## Passes when

The Kysely dialect's driver can be written against the bindings, 30 files attach read-only, and a
reader sees a writer's committed rows.

## Run

```bash
bun run --filter ./research/turso-bindings check
```

## Result

The spike passes on `@tursodatabase/database` 0.8.3, Bun 1.4.3 and `sqlite3` 3.53.4, but an attached
file keeps the snapshot it took at attach, so the API's attach path misses later commits.

**Driver mapping:** the driver calls `db.prepare(sql)`, then `statement.all(...params)` when
`statement.reader` is true and `statement.run(...params)` otherwise, and converts the `changes` and
`lastInsertRowid` numbers from `run` to `bigint`. `statement.iterate` streams rows. Kysely's
transaction calls go through `db.exec`, because `db.transactionAsync` takes a callback.

**Attach:** `attach` needs `experimental: ["attach"]`. One connection attaches the 30 files in 12 ms
to 59 ms, and 126 in all, past SQLite's limit of 125. A `file:<path>?mode=ro` URI refuses all 30
writes, and a bare path attaches read-write. A `union all` over an `entity` view inside each file
returns all 30 rows, and a view in the main database over attached tables is refused.

**Cross-process reads:** a writer opened without `experimental: ["multiprocess_wal"]` locks the file
against every second writer. With the flag in both processes, a direct read-only connection sees the
other process's commit on its next query, and so does this binding beside a Rust `turso` 0.8.3
writer with `experimental_multiprocess_wal(true)` (17 of 17). An attached file sees it only after a
detach and attach, or when a direct `multiprocess_wal` connection to it opened in-process first.

**Full-text search:** `create index doc_fts on doc using fts (body)` needs
`experimental: ["index_method"]`. `fts_match` finds a word, a ticket key and a commit SHA, through
an attach too. `fts_score` returns a nonzero score only when its query is the same literal or
numbered parameter (`?1`) as in `fts_match`, so two plain `?` placeholders, as Kysely writes them,
score 0. `sqlite3` refuses the file as a malformed schema.

**Vector search:** `vector_distance_cos` over `vector32` blobs gives exact nearest-neighbour search
with no flag. The binding has no approximate index for dense vectors: `libsql_vector_idx` and
`vector_top_k` fail, and `toy_vector_sparse_ivf` takes only sparse vectors.

**MVCC:** `pragma journal_mode = 'mvcc'` needs no flag and changes the format: header bytes 18 and
19 go from 2 to 255, `sqlite3` reports "file is not a database", and a WAL connection refuses to
attach the file. Turso reopens it with every row.

## Untested

- rusqlite on a file that holds a full-text index, and `@tursodatabase/database` 0.9.x
- a Kysely query through a written driver, and search at the owner's volume
