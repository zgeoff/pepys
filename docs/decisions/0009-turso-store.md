# 0009: The store is Turso, one file per consumer

Date: 2026-10-22

## Decision

The host writes the store with the Turso engine, embedded, with multi-version concurrency control
off. Each consumer owns one file with its tables, its offsets and its change log. Readers attach the
files read-only. rusqlite on the same files is the fallback.

## Rejected alternatives

| Option                   | Why not                                                                                 |
| ------------------------ | --------------------------------------------------------------------------------------- |
| plain SQLite             | attaches ten databases by default and 125 at most, which one file per consumer outgrows |
| DuckDB                   | an analytics engine, slow for many small upserts                                        |
| Postgres                 | the owner's stack for pepys excludes it                                                 |
| one shared database file | ownership, swaps and atomic batches would cross consumers                               |

## Why

One writer per file removes the need for concurrent writes. Keeping a consumer's tables, offsets and
change log in one file makes each batch one transaction. Turso writes the SQLite file format, so a
failure in Turso costs a dependency swap, not a migration, and any SQLite tool can open a file to
debug it.
