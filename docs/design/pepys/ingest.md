# Ingest

The built ingest serves receive routes and pull timers, as
[ingest](../../architecture/ingest/ingest.md) describes, and the GitHub source fills its live and
recovery paths, as [the GitHub plug-in](../../architecture/plug-ins/github.md) describes. This
design gives every source a backfill path for history from before pepys started, adds blobs to what
ingest writes, and adds Gmail as the second source of personal data. GitHub and Gmail show what
every source does.

## What every source does

Each source has a live path, a recovery path for what the live path misses, and a backfill path for
history from before pepys started. A source writes to its own fact families, named
`facts.<source>.<family>`, and names its entities `<source>:<kind>:<id>`. A new source therefore
adds streams, tables and consumers of its own, and changes nothing that another source owns.

All three paths produce events wherever the source has a history API. Observations appear after a
gap longer than the source keeps its history, and for objects with no history API, such as Gmail
labels. The first two sources fill the three paths as follows.

| Source | Live                                     | Recovery                                | Backfill        |
| ------ | ---------------------------------------- | --------------------------------------- | --------------- |
| GitHub | GitHub App webhooks                      | failed deliveries from the delivery log | timeline APIs   |
| Gmail  | polling `history.list` from a history ID | the same poll, resumed from its cursor  | `messages.list` |

## GitHub

After an outage longer than GitHub keeps its webhook deliveries, ingest polls the affected objects
once and writes observations. The
[source retention spike](../../../research/source-retention/README.md) quotes GitHub's limit and
probes it.

Backfill reads the pull request and issue timeline APIs, which return past events with their times.
Those events go into the same stream as the live events for the same entity.

Ingest leaves git data to [enrichment](./enrichment.md). The GitHub API caps and truncates large
diffs and offers no blame, so a local mirror serves both.

## Gmail

Gmail push needs Google Pub/Sub, a hosted service, so ingest polls instead. `history.list` returns a
change log of message additions, deletions and label changes since a history ID, which makes the
poll a source of events.

`history.list` returns message IDs only, so ingest fetches each new message in raw form. The raw
MIME message goes to the blobs bucket, and the fact holds the Gmail metadata, the headers and a
reference to the raw blob. The raw message keeps everything; enrichment extracts the text from it.

Gmail keeps a history ID valid for no fixed time: by its documentation, typically at least a week,
and in rare cases only a few hours. When the stored history ID has expired, Gmail returns HTTP 404,
and ingest runs one full sync from `messages.list` before it resumes polling, whatever the length of
the outage.

## Writes

Ingest writes in the order the [log](./log.md#cursors) requires: blobs, then facts, then the
poller's cursor record. Every write is safe to repeat, because fact IDs are deterministic and blobs
are named by their content. Ingest writes a blob before it appends the fact that references it, so a
fact never points at a missing blob.
