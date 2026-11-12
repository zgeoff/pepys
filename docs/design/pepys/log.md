# Log

The built log holds one stream per source fact family, as
[the fact log](../../architecture/ingest/fact-log.md) describes. This design adds three kinds of
stream, for poller cursors, for manual assertions and for enrichment results, and the rules a poller
follows when it records events and observations. Every new stream keeps the built log's rules: one
stream per fact family, kept forever, with a deterministic ID on every fact.

## Streams

| Stream           | Holds                                               | Written by |
| ---------------- | --------------------------------------------------- | ---------- |
| `facts.cursors`  | each poller's position in its source                | ingest     |
| `facts.manual`   | links and corrections that people and agents assert | the API    |
| `facts.enrich.*` | enrichment results                                  | enrichment |

One entity's history is a query over the fact index, not a stream of its own, so consumers tail a
fixed set of streams.

s2-lite has no built-in access control, so a k3s NetworkPolicy lets only its five clients reach it:
ingest, enrichment and the API append facts, and the host and compaction only read them.

## Fact IDs

| Fact kind         | ID                                                          |
| ----------------- | ----------------------------------------------------------- |
| source event      | `event:gmail:<history id>:<message id>:<change>` for Gmail  |
| observation       | a hash of the source, the entity and the source update time |
| enrichment result | a hash of the job, the job version and the input hash       |
| manual assertion  | a hash of the client ID and the request ID the client sends |

Deterministic IDs let pollers and webhook receivers write duplicates freely. Polls overlap and
webhooks repeat, and neither needs to prevent it at write time.

## Cursors

A poller records where it is in its source in the `facts.cursors` stream. Each poll writes in a
fixed order: blobs first, then facts, then one cursor record. A crash between the facts and the
cursor record makes the poller repeat that range on restart, which writes duplicates that the fact
IDs make harmless. No transaction spans two streams.

The cursor lives in its own stream because one poller can write several fact streams, and a backfill
and a live poller can write the same one, so the last record of a fact stream does not identify any
one poller's position.

## Events and observations

A fact is either an event or an observation:

- An event records one change exactly as it happened, from a webhook or a source history API.
- An observation records the full state of an object as a poll saw it.

pepys prefers events. For a source with a history API, observations exist only to resync after a gap
longer than the source keeps its history, such as a server outage longer than GitHub keeps webhook
deliveries. An object with no history API, such as a Gmail label, is always recorded as
observations. A poller writes an observation only when the object changed since the last
observation, so a frequent poll does not fill the log with identical copies.

Consumers treat both kinds alike for current state, where the newest source update time wins.
History treats them differently, as [History](./history.md) describes.
