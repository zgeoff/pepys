# 0009: The store is Turso, one file per consumer

Date: 2026-10-22 Updated: 2026-10-24

## Decision

The host writes the store with the Turso engine, embedded, with multi-version concurrency control
off. Each consumer owns one file with its tables, its offsets and its change log. Readers open the
files read-only, each through its own connection. rusqlite on the same files is the fallback.

## Rejected alternatives

| Option                   | Why not                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- |
| plain SQLite             | attaches ten databases by default and 125 at most, which one file per consumer outgrows |
| DuckDB                   | an analytics engine, slow for many small upserts                                        |
| Postgres                 | the owner's stack for pepys excludes it                                                 |
| one shared database file | ownership, swaps and atomic batches would cross consumers                               |
| long-lived attaches      | an attached file keeps the snapshot it took at attach, so it misses later commits       |

## Why

One writer per file removes the need for concurrent writes. Keeping a consumer's tables, offsets and
change log in one file makes each batch one transaction. Turso writes the SQLite file format, so a
failure in Turso costs a dependency swap, not a migration. A file that holds a Turso full-text index
is the exception: the `sqlite3` tool cannot open it, and rusqlite on such a file is unverified.

## Changes

- 2026-10-24: readers open each file through its own read-only connection instead of keeping it
  attached, and a file with a full-text index is no longer claimed to open in any SQLite tool, after
  the [Turso spike](../../research/turso-bindings/README.md).
