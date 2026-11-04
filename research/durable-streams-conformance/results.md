# Durable Streams conformance: results

The spike passes: a Bun server over a Turso change log passes all 129 tests of the read subset of
`@durable-streams/server-conformance-tests` 0.3.7 in 3 of 3 runs. The State Protocol client holds a
correct copy of the table over SSE and over long-poll. The [README](README.md) holds the question
and the answer.

## Method

1. Create a Turso file with a change log table and a few hundred rows.
2. Serve catch-up reads, long-poll and server-sent events from it over HTTP.
3. Run the server conformance tests and select the read tests.
4. Point `@durable-streams/state` at the server and materialize the table.

The spike passes when the server passes every read conformance test, and the State Protocol client
holds a correct copy of the table.

## Setup

The spike ran on Bun 1.4.3 and Node 24.13.0, with these packages:

| Package                                     | Version | Role                                        |
| ------------------------------------------- | ------- | ------------------------------------------- |
| `@durable-streams/server-conformance-tests` | 0.3.7   | the server conformance tests                |
| `@durable-streams/client`                   | 0.2.7   | the client that the tests and StreamDB use  |
| `@durable-streams/state`                    | 0.3.2   | the State Protocol client, `createStreamDB` |
| `@tanstack/db`                              | 0.15.2  | the collections that StreamDB fills         |
| `vitest`                                    | 4.1.12  | the runner the conformance tests need       |
| `@tursodatabase/database`                   | 0.8.3   | Turso, through `@pepys/kysely-turso`        |
| `kysely`                                    | 0.29.7  | the query builder over Turso                |

All three `@durable-streams` packages and vitest are the newest releases older than 7 days. The
newest `@tanstack/db` is 1.0.0-rc.1.3, but `@durable-streams/state` 0.3.2 declares the peer range
`>=0.6.0 <1.0.0`, so the spike pins 0.15.2. Turso and Kysely match the repo's catalog.

Run it from the repo root, with `node` on the `PATH`:

```bash
bun run --filter ./research/durable-streams-conformance check
```

[run-spike.ts](run-spike.ts) creates a Turso file in a temporary folder and starts the server on a
free port. It runs the conformance tests under vitest on Node, then runs the State Protocol check
twice, once for each live mode. It prints one JSON report and exits non-zero when a read test fails
or a client copy differs from the table. The server holds a long-poll for 2 s and an SSE connection
for 60 s, and it caps a response at 4 KiB of whole batches.

The server keeps a `stream` table and a `change_log` table with one row per batch. A batch's number
is its offset, written as 16 zero-padded digits so that offsets sort as strings. A JSON batch is
stored as a JSON array of its messages, and a read joins the arrays of its batches into one array. A
live reader waits on an in-process signal, which each commit sends.

The read side is 411 lines over 8 files: [handle-read.ts](handle-read.ts),
[handle-sse-read.ts](handle-sse-read.ts) and the helpers they import. The write fixture is 236 lines
over 4 files. The server entry and the change log module add 172 and 267 lines, and each serves both
sides.

## The read subset

The suite has no read tag, so the spike picks its read tests by group name, in
[build-conformance-summary.ts](build-conformance-summary.ts). The spike also counts 11 tests from
write groups as read tests, such as `should return correct headers on GET` in HTTP Protocol.

- A read group's tests assert on a GET or HEAD response: catch-up, long-poll, SSE, offsets, ETags,
  closure, JSON responses and security headers.
- A write group tests stream creation and appends, which pepys never serves.
- An out-of-scope group tests a feature pepys never needs: idempotent producers, forks, TTL and
  expiry, and subscriptions.

Every read test creates its stream with PUT and fills it with POST before it reads. A server with no
write side fails all of them. The spike's server therefore has a write side, in
[handle-create.ts](handle-create.ts) and [handle-append.ts](handle-append.ts), that exists only to
seed the tests. It writes to the same change log table that the read side reads.

## Conformance results

The three runs of the final runner give the same counts. The suite takes 46.4 s to 46.6 s.

| Scope        | Passed | Failed | Skipped |
| ------------ | ------ | ------ | ------- |
| read         | 129    | 0      | 0       |
| write        | 55     | 1      | 0       |
| out of scope | 64     | 83     | 6       |

| Read group                                    | Tests |
| --------------------------------------------- | ----- |
| SSE Mode                                      | 31    |
| Offset Validation and Resumability            | 20    |
| JSON Mode                                     | 16    |
| Browser Security Headers                      | 9     |
| Caching and ETag                              | 5     |
| Long-Poll Edge Cases                          | 5     |
| State Hash Verification (property)            | 4     |
| Stream Closure: SSE                           | 4     |
| Stream Closure: long-poll and HEAD            | 4     |
| Read Operations                               | 3     |
| HEAD Metadata                                 | 3     |
| Read-Your-Writes Consistency                  | 3     |
| Stream Closure: catch-up                      | 3     |
| Long-Poll Operations                          | 2     |
| Chunking and Large Payloads                   | 2     |
| Byte-Exactness (property)                     | 2     |
| Immutability and Offset Validation (property) | 2     |
| Read tests in write groups                    | 11    |

The one write failure, `close-with-different-body-dedup`, sends idempotent producer headers, which
the server ignores. The out-of-scope failures are producer and fork tests. All 30 TTL and expiry
tests outside the fork groups pass, because the server stores TTL and expiry and checks them on each
access. The 6 skipped tests are the subscription tests, which the suite runs only when its
`subscriptions` option is set.

Six read tests failed on the first run and pass after two fixes. A long-poll at `offset=now` must
wait for data, not return at once. The SSE tests match `data:` with no space after the colon. An SSE
reader drops one space after the colon, so the server adds a space to each line that starts with
one. A probe showed a live ` world` reaching the client as `world` before that change, and as
` world` after it.

## State Protocol check

[run-state-check.ts](run-state-check.ts) plays the host. Each batch writes the `item` table and its
change log row in one transaction, through `@pepys/kysely-turso`. The seed has 200 inserts, 70
updates and 30 deletes, one batch each, with invented items. `createStreamDB` then reads the stream
with `preload()`, and the check compares its collection with the `item` table. Next, 5 more batches
(2 inserts, 2 updates, 1 delete) commit and signal, once the server holds the client waiting at the
tail. The check polls every 5 ms until the collection matches the table again, with a 1 s limit. The
limit is below the 2 s long-poll timeout, so a client that misses the signal fails the check. A
probe with the signal switched off failed it in both live modes.

| Live mode | Change log rows | Table rows | Preload  | Preload copy | Live copy | Live catch-up |
| --------- | --------------- | ---------- | -------- | ------------ | --------- | ------------- |
| sse       | 305             | 171        | 63–68 ms | matches      | matches   | 26–35 ms      |
| long-poll | 305             | 171        | 57–64 ms | matches      | matches   | 29 ms         |

Each range covers the three runs. The live catch-up runs from the start of the first live write to
the first poll that finds a match, so it includes the 5 writes.

## Untested

- The host's after-commit signal over a local socket, and an API in a separate process from the
  host. The spike's writer and reader share one process and one Turso connection.
- Generations: a snapshot at the start of a stream, a closed old generation, and a reader that moves
  to the next one.
- Trimming the change log, and the protocol's gone response to a reader behind the trimmed range.
- A read-only API with the write path left out of production, which the API's own conformance check
  needs.
- The conformance tests under `bun test`: they need vitest, so the spike runs them on Node.
- TanStack DB 1.0, which `@durable-streams/state` 0.3.2 does not accept.
- The owner's volume, many concurrent readers, and a CDN in front of the API.
