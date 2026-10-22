# 0013: Deletions become tombstones

Date: 2026-10-22

## Decision

A deletion in any source, deleted email included, becomes a tombstone. The fact stays in the log,
the blob stays in the blobs bucket, and the projection marks the row deleted.

## Rejected alternatives

| Option                | Why not                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| purging deleted email | breaks the rule that facts are never deleted, and append-only streams cannot remove a record anyway |

## Why

The log is the source of truth, and a tombstone keeps it whole. A real purge, if one is ever needed,
removes the blob, which lives outside the log.
