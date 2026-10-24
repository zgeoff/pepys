# Spike: Durable Streams conformance

The API serves each consumer's change log over the read side of the Durable Streams protocol, and
clients such as TanStack DB rely on exact protocol behaviour. This spike runs the protocol's server
conformance tests against a small server, for the change feed design.

## Question

Can a small Bun server over a Turso change log pass the read subset of the Durable Streams server
conformance tests?

## Answer

- The spike has not run, so it holds no verdict and no numbers.

The change feed design holds no recommendation from this spike until it runs.

## Results

[results.md](results.md) holds the method and the check the spike must pass.

## Untested

Every step of the method, until the spike runs: [Untested](results.md#untested).
