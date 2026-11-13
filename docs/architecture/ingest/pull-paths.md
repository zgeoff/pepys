# Pull paths

A pull path is a function of a source that [ingest](./ingest.md) runs on a timer to get facts from
the source. This doc covers the timers, the lock of a source, resync marks and saved cursors.

Ingest starts one timer for each pull path that sets an interval. Ingest never runs a pull path with
no interval on its own. Code that holds the result of `createIngest` can run such a path once
through `runPull`, as the tests do.

Ingest holds one lock per source, in memory. A run takes the lock of its source before its pull
starts, so two pull paths of one source never run at the same time, and the pull paths of two
sources do. A `runPull` call takes the same lock as a timer's run.

A run that finds the lock taken waits, and the waiting runs go in the order they asked. A timer
starts no run while its last run waits or runs, so each timer has at most one run in the queue. A
waiting run keeps its turn, because a skipped turn would leave an hourly pull two hours between
runs. When ingest stops, a waiting run ends, and its pull never starts.

A pull's batch goes through the same batch checks and appends as a delivery. When a pull returns a
fact with a blob, ingest appends nothing from that run, logs the error, and keeps the cursor.

Ingest keeps resync marks, one per entity whose row may be stale. A delivery on a receive path can
set a mark, and the resync pull of the same ingest process reads the marks.
[The resync pull](../plug-ins/github.md#the-resync-pull) lists when the GitHub webhook sets one.
Ingest removes each mark only after the run's whole batch is stored, so a failed run keeps every
mark for the next one. Ingest keeps the marks in memory, at most 10,000 per source with the oldest
dropped first, and a restart loses them.

## Cursors

A cursor is a pull path's position in its source. A run passes the pull its cursor, and a batch
brings the next one. After a run's facts are stored, ingest appends one
[cursor record](./fact-log.md#the-cursor-stream) to the `facts.cursors` stream, and only then counts
the run as stored. A run that ends on the cursor it started from appends no record.

When an append of the facts fails, ingest appends no cursor record. When the append of the cursor
record fails, or ingest stops before it, the next run starts from the old cursor and pulls the same
facts again. The host skips the copies.

At start, ingest reads the newest cursor record of each timer's pull path, and the timer's first run
passes that cursor. For each timer, ingest prints one line to stdout, such as
`pull github recovery {"source":"github","path":"recovery","cursor":"saved"}`, where `cursor` is
`saved` or `none`. Ingest never prints the cursor itself, because a source chooses what its cursor
holds.

When a pull reports that its cursor expired, the timer drops the cursor, and the next run passes
none. No record marks the drop, so a restart before the next stored run passes the expired cursor
once more. On any other failure, ingest logs the error and keeps the cursor.

A caller of `runPull` passes the cursor itself, and a stored run appends its record in the same way.
