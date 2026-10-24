# Durable Streams conformance: results

The spike has not run. This file holds its method and the check it must pass, and the
[README](README.md) holds the question.

## Method

1. Create a Turso file with a change log table and a few hundred rows.
2. Serve catch-up reads, long-poll and server-sent events from it over HTTP.
3. Run the server conformance tests and select the read tests.
4. Point `@durable-streams/state` at the server and materialize the table.

The spike passes when the server passes every read conformance test, and the State Protocol client
holds a correct copy of the table.

## Setup

The spike has no runner yet, and its `package.json` pins no version.

## Untested

Every step of the method, until the spike runs.
