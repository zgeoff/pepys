# Spike: Parquet escape hatch

The lake keeps a Parquet copy of every fact so that pepys survives the loss of s2-lite. This spike
rebuilds a projection from that copy alone, for the history design.

## Question

Can the host rebuild one consumer's file from the lake with s2-lite stopped, and does the result
equal the file built from the log?

## Answer

- The spike has not run, so it holds no verdict and no numbers.

The history design holds no recommendation from this spike until it runs.

## Results

[results.md](results.md) holds the method and the check the spike must pass.

## Untested

Every step of the method, until the spike runs: [Untested](results.md#untested).
