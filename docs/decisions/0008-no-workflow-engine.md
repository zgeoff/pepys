# 0008: No workflow engine

Date: 2026-10-22

## Decision

pepys runs no durable workflow engine. The host schedules scope work with keyed locks and an
in-memory dirty set that it rebuilds from offsets on restart, and enrichment keeps its results as
facts in the log.

## Rejected alternatives

| Option                  | Why not                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------- |
| Restate virtual objects | repeat what the host and the log give on one node, and add state on local disk outside the bucket |

## Why

On one node, a keyed lock gives one run per scope at a time, the dirty set gives the queue and the
debounce, and write-back facts keep every outside result. A workflow engine returns only if the host
runs on several nodes or enrichment grows long multi-step workflows.
