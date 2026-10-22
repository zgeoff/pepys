# 0011: Per-source entity tables with a shared view

Date: 2026-10-22

## Decision

Each entity kind has a per-source table with every column it needs, and each consumer file defines
an `entity` view with six shared columns. The query layer unions those views for cross-source
queries. Generic tables shared across sources wait until a second source of one kind exists.

## Rejected alternatives

| Option                         | Why not                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------- |
| generic tables from the start  | lose detail with one source per kind, and gain nothing the `kind` column does not give |
| a separate shared entity table | a second copy of each row that can disagree with the full table                        |

## Why

The full table keeps every detail, and the view makes cross-source queries possible with no copy, so
the two cannot disagree.
