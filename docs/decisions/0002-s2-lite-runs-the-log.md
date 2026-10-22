# 0002: s2-lite runs the log

Date: 2026-10-22

## Decision

The log runs on s2-lite, which stores its streams in the facts bucket through SlateDB and
acknowledges an append only once it is durable there. A k3s NetworkPolicy gates access, because
s2-lite has no access control of its own. A daily Parquet copy of every fact in the lake limits the
risk of a young project.

## Rejected alternatives

| Option                     | Why not                                               |
| -------------------------- | ----------------------------------------------------- |
| NATS JetStream             | keeps the log on local disk, outside the bucket       |
| Fluvio                     | keeps the log on local disk, with a smaller community |
| JSON lines files in Garage | pepys would then maintain its own log engine          |
| a Postgres table           | the owner's stack for pepys excludes Postgres         |

## Why

s2-lite is the only option that keeps the log in the bucket, which
[decision 0001](./0001-object-storage-holds-all-state.md) requires. The fact envelope belongs to
pepys, not to S2, and the Parquet copy is complete, so replacing s2-lite costs an export and a
replay, not data.
