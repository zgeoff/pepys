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

The spike has no runner yet.

## Result

The spike has not run.

## Untested

Every step of the method, until the spike runs.
