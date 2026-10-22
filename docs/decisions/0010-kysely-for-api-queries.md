# 0010: The API queries with Kysely through its own Turso dialect

Date: 2026-10-22

## Decision

The API writes its queries with Kysely, through a dialect for the Turso TypeScript bindings that
reuses Kysely's SQLite pieces. The Kysely types are generated from the consumer declarations. The
[API design](../design/pepys/api.md#registered-queries) describes how each query is served.

## Rejected alternatives

| Option                                   | Why not                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| SQL files with generated typed functions | weak for queries whose shape changes per request, such as the neighbourhood walk |
| a second query tool beside Kysely        | two ways to do one job                                                           |

## Why

Kysely keeps the SQL visible and types it, and it builds dynamic queries well. Generating its types
from the same declarations as the WIT and the host's Rust types keeps every language on one schema.
