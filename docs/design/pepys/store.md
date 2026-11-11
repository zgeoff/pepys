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
[Turso spike](https://github.com/zgeoff/pepys/blob/894eb4e7f9bf702d77d797475ab45ddef47b37c4/research/turso-bindings/results.md)
records the TypeScript binding's behaviour that the API builds on.

## One file per consumer

A consumer's file holds three things the consumer's batches change together:

- the consumer's tables;
- its offsets into the log or the change feed;
- its change log, which the [change feed](./change-feed.md) serves.

Keeping all three in one file is what makes a batch atomic without a transaction across files.

## Reading files

Each API call opens one connection on an empty in-memory database, and attaches read-only the
current file of each consumer it reads. The call resolves each consumer's `current` link at its
start, so a version swap during the call changes nothing for it, and the next call reads the new
file.

Turso refuses to attach a file that the host holds open with its multi-process write-ahead log,
unless the reading process holds a handle of its own. The API therefore keeps one read-only handle
on each current file, and through that handle each attach sees the host's newest commit. The API
closes the handle once a swap retires the file and the last call on it ends.

Each consumer's `entity` view lives in its own file. Turso refuses a TEMP view over attached files,
so each query gets the `union all` across the attached `entity` views as a common table expression.
The `link_effective` view is built the same way.

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
independent of what scriptc can compile.
[Decision 0022](../../decisions/0022-consumers-are-core-modules.md) sets how a consumer reads rows.
