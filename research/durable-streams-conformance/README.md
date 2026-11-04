# Spike: Durable Streams conformance

The API serves each consumer's change log over the read side of the Durable Streams protocol, and
clients such as TanStack DB rely on exact protocol behaviour. This spike runs the protocol's server
conformance tests against a small Bun server over a Turso change log, for the change feed design.

## Question

Can a small Bun server over a Turso change log pass the read subset of the Durable Streams server
conformance tests?

## Answer

- The spike passes on `@durable-streams/server-conformance-tests` 0.3.7: the server passes all 118
  read tests in 3 of 3 runs, from a change log with one row per batch.
- The read side takes 404 lines of TypeScript: catch-up, long-poll, server-sent events, ETags and
  cursors.
- Every read test creates and fills its own stream with PUT and POST, so a read-only server can't
  run the suite. The spike adds a 236-line write path that serves only as a test fixture.
- `@durable-streams/state` 0.3.2 with `@tanstack/db` 0.15.2 materializes a 171-row table from 305
  change log rows over SSE and over long-poll. Each copy matches the Turso table.
- The client holds all 5 live batches 27 ms to 41 ms after the first of them starts to write.

Give the API a write path for tests only, which the conformance check uses and production never
routes.

## Run it

```bash
bun run --filter ./research/durable-streams-conformance check
```

The runner needs Node for vitest. The versions and the run are in [Setup](results.md#setup).

## Results

[results.md](results.md) holds the read subset, every group's result, and the State Protocol check.

## Untested

The host's socket signal, a separate API process, generations, trimming, the gone response and the
owner's volume: [Untested](results.md#untested).
