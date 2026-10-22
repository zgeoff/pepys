# Store

The store is a set of database files, one per consumer, written by the Turso engine embedded in the
[host](./host.md). Each file holds the consumer's tables, its offsets and its change log, so every
transaction stays inside one file. Readers attach other consumers' files read-only to query across
them. The files use the SQLite file format, so any SQLite tool can open them, and the whole store
rebuilds from the log.

## Turso

Turso is a rewrite of SQLite in Rust. It runs embedded in the host as one native Rust dependency,
and it lifts SQLite's limit on attached databases, which a store with one file per consumer reaches
quickly.

Each file has one writer, so the store needs no concurrent writes. Turso's multi-version concurrency
control stays off. It is still experimental, and turning it on may change the file format.

If Turso fails, the host switches to rusqlite and opens the same files, with no migration and no
replay. The [Turso spike](./spikes/turso-bindings/README.md) checks the attach behaviour and the
TypeScript bindings before the API depends on them.

## One file per consumer

A consumer's file holds three things the consumer's batches change together:

- the consumer's tables;
- its offsets into the log or the change feed;
- its change log, which the [change feed](./change-feed.md) serves.

Keeping all three in one file is what makes a batch atomic without a transaction across files. A
consumer that reads another consumer's tables attaches that file read-only, and the API attaches
every file read-only for cross-source queries.

## Queries

The API queries the store with Kysely, through a Kysely dialect built for the Turso TypeScript
bindings. The dialect reuses Kysely's SQLite adapter, query compiler and introspector, and adds a
driver and a connection over Turso. It is written as plain functions and objects.

The API never writes. Writes from people and agents go to the log as manual facts, and the host
applies them, so one connection serves the read-only API without transactions colliding.

The API uses the Kysely types generated from the
[consumer declarations](./consumers.md#one-schema-source).

Consumers do not use Kysely. They read through typed get and scan host calls, which keeps SQL out of
the module boundary and keeps the boundary independent of what scriptc can compile.
