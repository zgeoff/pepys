# 0010: The API queries with Kysely through its own Turso dialect

Date: 2026-10-22 Updated: 2026-10-24

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
from the same declarations as the module boundary's glue and the host's Rust types keeps every
language on one schema.

## Changes

- 2026-10-24: the module boundary is generated glue over core-module memory, not WIT, after
  [0022](./0022-consumers-are-core-modules.md).
