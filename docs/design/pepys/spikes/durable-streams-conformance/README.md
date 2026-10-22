# Spike: Durable Streams conformance

The API serves each consumer's change log over the read side of the Durable Streams protocol.
Clients such as TanStack DB rely on exact protocol behaviour, and the protocol's repository ships
conformance tests that define it.

## Question

Can a small Bun server over a Turso change log pass the read subset of the Durable Streams server
conformance tests?

## Method

1. Create a Turso file with a change log table and a few hundred rows.
2. Serve catch-up reads, long-poll and server-sent events from it over HTTP.
3. Run the server conformance tests and select the read tests.
4. Point `@durable-streams/state` at the server and materialize the table.

## Passes when

The server passes every read conformance test, and the State Protocol client holds a correct copy of
the table.
