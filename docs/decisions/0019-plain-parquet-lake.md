# 0019: The lake is plain Parquet

Date: 2026-10-22

## Decision

A daily job copies every fact into Parquet files in the lake bucket, by stream and by day. The lake
is the escape hatch for s2-lite and the place for heavy analytics through DuckDB.

## Rejected alternatives

| Option                                     | Why not                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| DuckLake from the start                    | a catalog, snapshots and schema changes that a backup copy with occasional queries does not use |
| the lake as the source for "as of" queries | transitions and the fact index answer those from the store                                      |

## Why

The lake's main job is to keep the facts in a format no stream engine owns. Plain Parquet does that,
and DuckLake can sit on top later if the lake gets queried often.
