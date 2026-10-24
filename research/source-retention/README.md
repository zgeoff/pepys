# Spike: Source history retention

Ingest recovers from an outage through GitHub's delivery log and Gmail's history IDs, and each
source keeps that history for a limited time. This spike measures both limits, for the ingest
design's choice of when to resync with observations.

## Question

How long does GitHub keep an App's webhook deliveries for redelivery, and how long does a Gmail
history ID stay valid?

## Answer

- The spike has not run, so it holds no verdict and no numbers.

The ingest design holds no recommendation from this spike until it runs.

## Results

[results.md](results.md) holds the method and the check the spike must pass.

## Untested

Every step of the method, until the spike runs: [Untested](results.md#untested).
