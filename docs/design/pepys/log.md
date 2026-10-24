# Log

The log is the one place facts enter pepys. It runs on s2-lite, a single-binary server for the S2
streams API that stores its data in the facts bucket through SlateDB. s2-lite acknowledges an append
only after the data is durable in the bucket. The log holds one stream per fact family, keeps every
record forever, and never rewrites a record. s2-lite's default retention is 7 days, so pepys creates
every stream with infinite retention.

## Streams

A fact family is the set of facts that one entity consumer projects, so each stream has exactly one
entity consumer reading it. Streams are named after what is projected, not after the source's
webhook event names: `facts.github.pull_request` holds pull request webhooks and pull request
timeline backfill alike.

| Stream                                                    | Holds                                               |
| --------------------------------------------------------- | --------------------------------------------------- |
| one per source fact family, such as `facts.gmail.message` | source events and observations                      |
| `facts.cursors`                                           | each poller's position in its source                |
| `facts.manual`                                            | links and corrections that people and agents assert |
| `facts.enrich.*`                                          | enrichment results                                  |

S2 orders records within a stream and assigns each a sequence number, which consumers use as their
offset. The log gives no order between streams, and no consumer needs one: single-event links depend
on one fact each, and join links recompute from state.

One entity's history is a query over the fact index, not a stream of its own, so consumers tail a
fixed set of streams.

s2-lite has no built-in access control, so a k3s NetworkPolicy lets only its four clients reach it:
ingest, enrichment and the API append facts, and the host reads them.

## The fact envelope

Every fact has the same envelope around an untouched source payload:

| Field     | Holds                                                                         |
| --------- | ----------------------------------------------------------------------------- |
| `id`      | the deterministic fact ID                                                     |
| `type`    | the event type, such as `github.pull_request.opened`                          |
| `v`       | the envelope version                                                          |
| `api`     | the source API version that produced the payload, such as `github/2022-11-28` |
| `entity`  | the global ID of the main entity                                              |
| `actor`   | the global ID of the actor, when the source names one                         |
| `at`      | the source time                                                               |
| `cursor`  | the source position, for pollers                                              |
| `payload` | the raw source object                                                         |

Ingest keeps the payload whole, because some APIs never return old data, and a field trimmed today
is lost for good. Old facts are never rewritten: when a source changes the shape of its payload, the
consumer reads `api` and handles each shape it knows, then replays.

## Fact IDs

A fact's ID derives from its content, so the same fact written twice has the same ID and consumers
drop the duplicate.

| Fact kind         | ID                                                          |
| ----------------- | ----------------------------------------------------------- |
| webhook           | the source's delivery ID                                    |
| observation       | a hash of the source, the entity and the source update time |
| enrichment result | a hash of the job, the job version and the input hash       |
| manual assertion  | a UUID, since people do not repeat themselves by accident   |

Deterministic IDs let pollers and webhook receivers write duplicates freely. Polls overlap and
webhooks repeat, and neither needs to prevent it at write time. s2-lite can also store an append
whose acknowledgement never arrived, so a writer retries every append with an unknown outcome, and
the fact ID makes the stored copy harmless.

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
