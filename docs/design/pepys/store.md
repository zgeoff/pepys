# Store

The store is a set of database files, one per consumer, written by the Turso engine embedded in the
[host](./host.md). Each file holds the consumer's tables, its offsets and its change log, so every
transaction stays inside one file. Readers open the files read-only. The files use the SQLite file
format, and the whole store rebuilds from the log.

## Turso

Turso is a rewrite of SQLite in Rust. It runs embedded in the host as one native Rust dependency,
and it lifts SQLite's limit on attached databases, which a store with one file per consumer reaches
quickly.

Each file has one writer, so the store needs no concurrent writes. Turso's multi-version concurrency
control stays off. It is experimental, and turning it on changes the file format so that neither
`sqlite3` nor a plain Turso connection opens the file.

Every process that opens a file sets Turso's multi-process WAL option. A writer opened without it
locks the file, and a second process then cannot open it.

If Turso fails, the host switches to rusqlite and opens the same files, with no migration and no
replay. A file that holds a Turso full-text index is the exception: `sqlite3` rejects its schema,
and rusqlite on such a file is unverified. The
[Turso spike](../../../research/turso-bindings/results.md) records the TypeScript binding's
behaviour that the API builds on.

## One file per consumer

A consumer's file holds three things the consumer's batches change together:

- the consumer's tables;
- its offsets into the log or the change feed;
- its change log, which the [change feed](./change-feed.md) serves.

Keeping all three in one file is what makes a batch atomic without a transaction across files.

## Reading files

A read-only attach keeps the snapshot it took when it attached, so it misses every later commit. The
API therefore opens one direct read-only connection per consumer file, and that connection sees each
commit on its next query. A query across files attaches them read-only, and the API re-attaches a
file when the [change feed](./change-feed.md) reports a change to it. Each consumer's `entity` view
lives in its own file, and a `union all` across the attached views serves cross-source queries.

## Queries

The API queries the store with Kysely, through a Kysely dialect built for the Turso TypeScript
bindings. The dialect reuses Kysely's SQLite adapter, query compiler and introspector, and adds a
driver and a connection over Turso. It is written as plain functions and objects. Turso's
`fts_score` ranks a row only when its query is the same numbered parameter as in `fts_match`, so the
dialect binds full-text queries as numbered parameters, not as Kysely's plain placeholders.

The API never writes. Writes from people and agents go to the log as manual facts, and the host
applies them, so one connection serves the read-only API without transactions colliding.

The API uses the Kysely types generated from the
[consumer declarations](./consumers.md#one-schema-source).

Consumers do not use Kysely, which keeps SQL out of the module boundary and keeps the boundary
independent of what scriptc can compile. The
[host boundary spike](../../../research/host-boundary/README.md) settles how a consumer reads rows.
