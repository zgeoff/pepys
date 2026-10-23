# Ingest

Ingest turns source activity into facts. It is a TypeScript service on Bun, because its work is API
clients and HTTP handlers. A source is a package that the deployment plugs into ingest. GitHub and
Gmail are the first two sources, and this doc uses them to show what every source does.

## What every source does

Each source has a live path, a recovery path for what the live path misses, and a backfill path for
history from before pepys started. A source writes to its own fact families, named
`facts.<source>.<family>`, and names its entities `<source>:<kind>:<id>`. A new source therefore
adds streams, tables and consumers of its own, and changes nothing that another source owns.

All three paths produce events wherever the source has a history API. Observations appear after a
gap longer than the source keeps its history, and for objects with no history API, such as Gmail
labels. The first two sources fill the three paths as follows.

| Source | Live                                     | Recovery                               | Backfill        |
| ------ | ---------------------------------------- | -------------------------------------- | --------------- |
| GitHub | GitHub App webhooks                      | redelivery of failed deliveries        | timeline APIs   |
| Gmail  | polling `history.list` from a history ID | the same poll, resumed from its cursor | `messages.list` |

## GitHub

The owner installs a GitHub App on their account, and GitHub sends the App's webhooks to pepys. Only
the webhook path is reachable from the internet; the route to it lives in the owner's cloud
infrastructure repository. The receiver checks each webhook signature before it writes anything, and
rejects an unsigned or badly signed request with no further work.

GitHub does not retry a failed delivery on its own. A sweep lists the App's recent deliveries, finds
the ones that failed or never reached pepys, and asks GitHub to redeliver them. GitHub keeps its
delivery log for a limited time, so after an outage longer than that, ingest polls the affected
objects once and writes observations. The
[source retention spike](../../../research/source-retention/README.md) measures that limit.

Backfill reads the pull request and issue timeline APIs, which return past events with their times.
Those events go into the same stream as the live events for the same entity.

One webhook delivery becomes one fact in one stream, chosen by the webhook event name. A delivery
that embeds a copy of another object, such as the pull request inside a review event, does not
update that object: the copy is context, and only the object's own facts change its state.

Ingest leaves git data to [enrichment](./enrichment.md). The GitHub API caps and truncates large
diffs and offers no blame, so a local mirror serves both.

## Gmail

Gmail push needs Google Pub/Sub, a hosted service, so ingest polls instead. `history.list` returns a
change log of message additions, deletions and label changes since a history ID, which makes the
poll a source of events.

`history.list` returns message IDs only, so ingest fetches each new message in raw form. The raw
MIME message goes to the blobs bucket, and the fact holds the Gmail metadata, the headers and a
reference to the raw blob. The raw message keeps everything; enrichment extracts the text from it.

Gmail drops old history after a limited time. When the stored history ID has expired, Gmail returns
an error, and ingest runs one full sync from `messages.list` before it resumes polling.

## Writes

Ingest writes in the order the [log](./log.md) requires: blobs, then facts, then the poller's cursor
record. Every write is safe to repeat, because fact IDs are deterministic and blobs are named by
their content.
