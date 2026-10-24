# Turso from TypeScript: results

The spike passes on `@tursodatabase/database` 0.8.3: the binding fits a Kysely driver, 30 files
attach read-only, a per-file `entity` view unions across them, and a reader sees a second process's
commits. An attached file keeps the snapshot it took at attach, so the API's attach path misses
later commits. The [README](README.md) holds the question and the answer.

## Method

1. Open a Turso file from Bun and run a prepared select, an insert and an iterate over rows.
2. Create 30 consumer files, attach them all read-only to one connection, and union a view across
   them.
3. Write to one file from a second process while the first reads it.
4. Build a full-text index and a vector table, and query both.
5. Check whether turning multi-version concurrency control (MVCC) on changes the file format.

The spike passes when the Kysely dialect's driver can be written against the bindings, 30 files
attach read-only, and a reader sees a writer's committed rows.

## Setup

The spike ran on `@tursodatabase/database` 0.8.3, Bun 1.4.3 and `sqlite3` 3.53.4. The runner writes
its files to a fresh temp directory, and the second process is
[write-row-from-second-process.ts](write-row-from-second-process.ts). Run it from the repo root:

```bash
bun run --filter ./research/turso-bindings check
```

The Rust writer beside the binding is the `turso` 0.8.3 crate the host embeds. It ran as a probe
outside this runner.

## Driver mapping

The driver calls `db.prepare(sql)`, then `statement.all(...params)` when `statement.reader` is true
and `statement.run(...params)` otherwise. It converts the `changes` and `lastInsertRowid` numbers
from `run` to `bigint`. `statement.iterate` streams rows. Kysely's transaction calls go through
`db.exec`, because `db.transactionAsync` takes a callback.

## Attach

`attach` needs `experimental: ["attach"]`. One connection attaches the 30 files in 12 ms to 59 ms,
and 126 in all, past SQLite's limit of 125. A `file:<path>?mode=ro` URI refuses all 30 writes, and a
bare path attaches read-write. A `union all` over an `entity` view inside each file returns all 30
rows, and the binding refuses a view in the main database over attached tables.

## Cross-process reads

A writer opened without `experimental: ["multiprocess_wal"]` locks the file against every second
writer, so every process on a file sets the flag. With the flag in both processes, a direct
read-only connection sees the other process's commit on its next query. This binding sees it too
when the writer is a Rust `turso` 0.8.3 process with `experimental_multiprocess_wal(true)`: 17 of 17
commits in a probe.

An attached file sees the commit only after a detach and attach, or when a direct `multiprocess_wal`
connection to the file opened in the same process first. The API's read path therefore needs a
re-attach or direct connections.

## Full-text search

`create index doc_fts on doc using fts (body)` needs `experimental: ["index_method"]`. `fts_match`
finds a word, a ticket key and a commit SHA, through an attach too. `fts_score` returns a nonzero
score only when its query is the same literal or numbered parameter (`?1`) as in `fts_match`. Two
plain `?` placeholders, as Kysely's compiler writes them, score 0. `sqlite3` refuses the file as a
malformed schema.

## Vector search

`vector_distance_cos` over `vector32` blobs gives exact nearest-neighbour search with no flag. The
binding has no approximate index for dense vectors: `libsql_vector_idx` and `vector_top_k` fail, and
`toy_vector_sparse_ivf` takes only sparse vectors.

## MVCC

`pragma journal_mode = 'mvcc'` needs no flag and changes the format: header bytes 18 and 19 go from
2 to 255, `sqlite3` reports "file is not a database", and a WAL connection refuses to attach the
file. Turso reopens it with every row.

## Untested

- rusqlite on a file that holds a full-text index.
- `@tursodatabase/database` 0.9.x.
- A Kysely query through a written driver.
- Full-text and vector search at the owner's volume.
