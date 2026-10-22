# History

pepys answers questions about the past from the same facts it keeps for the present. A transition
table records how each field of each entity changed, and marks each step as exact or observed. The
fact index holds every fact for an entity, so any past state of that entity can be rebuilt by
replaying its facts up to a time. A daily compaction job copies the facts into Parquet files in the
lake bucket, which gives a copy of the log that does not depend on s2-lite and a place for heavy
analytics.

## Transitions

A transition row holds the entity, the field, the old value, the new value, the earliest time the
change could have happened, the latest time, and its fidelity.

| Fidelity | Comes from                        | Time                                 |
| -------- | --------------------------------- | ------------------------------------ |
| event    | a webhook or a source history API | exact                                |
| observed | two observations that differ      | a range between the two observations |

When an event and a pair of observations describe the same change, the event wins and the observed
transition is dropped. A query such as "time in review" is exact where webhooks arrived, and carries
a range where a webhook was lost.

Backfill arrives after the live events it predates, so order in the log is not order in time. A
scope-mode consumer, with the entity as its scope, reads the entity's facts from the fact index
sorted by source time and rebuilds its transitions on each change. A late fact marks the entity
dirty, and its history recomputes.

## Past states

A past state of one entity is a replay of that entity's facts from the fact index up to a time. Most
"what did this look like on that day" questions need nothing more.

## The lake

A compaction job runs daily and appends the new facts from each stream to Parquet files in the lake
bucket, by stream and by day. It records the stream offset it reached, so it resumes where it
stopped.

The lake has two purposes. It is the escape hatch for s2-lite: if s2-lite fails, the facts survive
in a format that no stream engine owns, and every projection rebuilds from them. It also serves
heavy analytics, such as review time per month across two years, through DuckDB, away from the
store.

The lake is plain Parquet. DuckLake, which adds a catalog, snapshots and schema changes on top,
joins only if the lake gets queried often.

The [escape hatch spike](./spikes/parquet-escape-hatch/README.md) rebuilds one consumer from the
lake with s2-lite stopped, which proves the copy is complete.
