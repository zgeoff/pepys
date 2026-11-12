# The fact log

The fact log is the one place facts enter pepys, and the one store that nothing can rebuild. It
holds one stream per fact family, keeps every record forever, and never rewrites a record. s2-lite
serves it: a single-binary server for the S2 streams API, which keeps its data in an object storage
bucket and acknowledges an append only once the data is durable there. Ingest is the only writer,
and the host reads each stream that a consumer declares. Every fact has a deterministic ID, so a
fact written twice has one ID, and each consumer drops the copy.

[Ingest](./ingest.md) covers the deliveries that produce the facts. [The host](../consumers/host.md)
covers how a consumer reads them.

## Streams

Each fact family has one stream, named `facts.<source>.<family>`, such as
`facts.github.pull_request`. A stream is named after what a consumer builds from it, never after a
webhook event's name, because a consumer then reads one stream for one kind of thing. S2 orders the
records of one stream and gives each a sequence number, which a consumer keeps as its offset. The
log gives no order between streams, and no consumer needs one, as
[decision 0003](../../decisions/0003-one-stream-per-fact-family.md) sets out.

Ingest creates each stream at start with infinite retention, because s2-lite keeps a record for a
limited time by default.

## The fact envelope

Every fact has one envelope around the payload the source sent:

| Field     | Holds                                                              |
| --------- | ------------------------------------------------------------------ |
| `id`      | the deterministic fact ID                                          |
| `type`    | the event type, such as `github.pull_request.opened`               |
| `v`       | the envelope version, 1                                            |
| `api`     | the source API version of the payload, such as `github/2022-11-28` |
| `entity`  | the global ID of the main entity                                   |
| `actor`   | the global ID of the actor, when the source names one              |
| `at`      | the source time, as an ISO date and time                           |
| `cursor`  | the source position, when a pull sets one                          |
| `payload` | the source object, whole                                           |

The envelope check refuses any other field. Ingest keeps the payload whole, because some source APIs
never return old data, so a field trimmed today is lost for good. When a source changes the shape of
its payload, the consumer reads `api` and handles each shape it knows.

A fact ID takes one of two forms. A webhook or event ID is `webhook:` or `event:`, a source name of
lowercase letters, digits and `_`, a colon, and one line of text. An observation, enrichment or
manual ID is `observation:`, `enrichment:` or `manual:` and 64 hex digits. The case file
`fact-envelope-cases.json` in the kit holds the accepted and refused envelopes, and the TypeScript
parser and the Rust host's check both test against it.

## One append

The fact log port has one write: it stores a list of facts of one stream in one append, guarded by
the offset that the first record must get. All the facts land or none does. The port also reads a
run of records from an offset, and reads a stream's tail. An append ends in one of three outcomes:
acknowledged, rejected, or unknown when the reply was lost.

s2-lite caps the number of records and the metered bytes of one append, where a record meters as its
stored body in UTF-8 bytes plus a fixed overhead. The fact log planner in `@pepys/ingest` holds both
caps, and ingest cuts one stream's facts into runs inside those limits and appends the runs one
after the other. Both adapters refuse an empty list, a longer one and a larger one as too large, so
the memory log refuses what s2-lite refuses. A fact that fits no append refuses the whole batch.

An unknown outcome is the case the guard exists for. s2-lite can store an append whose
acknowledgement never arrives, so ingest guards every attempt with the tail it expects, the first
attempt included, and settles an unknown outcome by reading exactly the offsets that the append
aimed at:

- When they hold every fact ID of the run, in order, the append landed.
- When they hold nothing, ingest sends the run again with the same guard.
- When they hold anything else, another writer took those offsets, and ingest appends the whole run
  again at the new tail.

A first attempt that lands late then fails its own guard, so exactly one copy of it lands. While an
attempt is unsettled, ingest reads those offsets again after every later outcome that aimed at them,
a tail mismatch included, because the mismatch may come from the late attempt itself. In the last
case a fact can be in the log twice, and no fact is lost. The consumers make the copy harmless.
Before an append, ingest also checks that the JSON it would store parses as an envelope, so a stored
body always reads back.

## Ports and their fixtures

| Port       | TypeScript adapters  | Rust adapters        | Used in a deployment by       |
| ---------- | -------------------- | -------------------- | ----------------------------- |
| fact log   | S2, memory           | S2, memory           | ingest writes, the host reads |
| blob store | Garage, local folder | Garage, local folder | nothing yet                   |

The TypeScript memory log is the test fake. It can lose the next reply, drop the next append in
favour of another writer's records, and land the next append late, so the appender's tests cover
each unknown outcome. The Rust memory log can only lose the next reply, because the host never
appends.

One set of fixture files per port, each a sequence of calls with the results it expects, drives a
conformance test on every adapter: the memory adapters under `bun test` and `cargo nextest run`, and
the S2 and Garage adapters in the e2e lanes. The Rust test checks that it runs every fixture file in
the folder, so a fixture added on one side fails until both sides run it.

The blob store keeps each file under the SHA-256 of its content, so a read of a hash always returns
the same bytes, and a consumer could read a blob without breaking replay. No deployment wires a blob
store in: ingest refuses a fact that carries a blob, and the host gives a consumer no blob read.

## Known limits

- The log is one bucket, and pepys copies it nowhere. A deployment that loses the bucket with no
  backup of its own loses every fact, and the host can then rebuild no table.
- A replay of a signed delivery after the one-hour window of
  [ingest](./ingest.md#why-a-fact-id-comes-from-the-signed-body) adds a copy of its facts to the
  log. The GitHub route is public, so its body limit and that window bound how fast the log grows.
