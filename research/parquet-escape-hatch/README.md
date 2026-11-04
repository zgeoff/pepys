# Spike: Parquet escape hatch

The lake keeps a Parquet copy of every fact so that pepys survives the loss of s2-lite. This spike
rebuilds a projection from that copy alone, for the history design.

## Question

Can the host rebuild one consumer's file from the lake with s2-lite stopped, and does the result
equal the file built from the log?

## Answer

- The spike passes in 3 of 3 runs: the file rebuilt from Parquet holds the same rows, offset,
  applied fact IDs and change log as the file `pepys run` built from s2-lite.
- 250 invented webhook facts, 14 of them redeliveries, fit in 3 Parquet files of 4.3 KB to 7.2 KB.
- The rebuild reads the lake, replays 250 facts through the consumer module and takes 1.3 s to 1.4 s
  in a debug build.
- The rebuild refuses a lake with a missing file, and a lake that holds fewer records than the
  offset the compaction job recorded.
- The `pepys` binary cannot run this rebuild: its fact log trait is private to the host crate, and
  every command reads s2-lite. The spike calls the host's public functions instead.

Give the host a lake adapter for its fact log, so that a rebuild from Parquet is a host command.

## Run it

```bash
PEPYS_ZIG_BIN=<zig binary> PEPYS_WASM_TOOLS_BIN=<wasm-tools binary> bun run --filter ./research/parquet-escape-hatch check
```

Run it from the repo root with Docker running. The tools and versions are in
[Setup](results.md#setup).

## Results

[results.md](results.md) holds the method, the pass check and the numbers of each run.

## Untested

More than one day per run, the lake in a Garage bucket, DuckDB on the files, and a crash of the
compaction job: [Untested](results.md#untested).
