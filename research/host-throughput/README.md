# Spike: Host throughput

The host's numbers so far came from inputs of a few dozen facts. This spike measures the host on a
release build with thousands to 100000 facts, and with scopes of up to 10000 facts.

## Question

How fast does the host apply a long stream, and how does the time of a batch grow with the length of
a scope?

## Answer

- A fact-mode consumer applies about 4000 facts per second, and a scope-mode consumer whose scopes
  hold 10 facts applies about 1500. A 100000-fact `up` took 26 s and 65 s.
- A scope-mode batch takes longer the longer its scopes are, and the growth is faster than linear.
  The same 10000 facts took 6.5 s in 1000 scopes, 27 s in 100 scopes, 42 s in 10 scopes and 231 s in
  one scope.
- A single scope of 10000 facts averages 2.3 s per batch, and its `up` took almost 4 minutes. The
  host recomputes the whole scope in every batch that holds one of its facts, as designed, so a
  scope that long is a limit for a deployment, not a crash. No run crashed, and the runs timed `up`
  without reading the rows.

[host.md](../../docs/architecture/consumers/host.md#limits) states each limit.

## Run it

```bash
export PEPYS_ZIG_BIN=<zig 0.16.0> PEPYS_WASM_TOOLS_BIN=<wasm-tools 1.262.0>
bun run consumers:build
cargo test --release -p pepys-host --no-run
PEPYS_BENCH_CONSUMERS=build/consumers/consumers.json PEPYS_BENCH_CONSUMER=ledger_account \
  PEPYS_BENCH_FACTS=10000 PEPYS_BENCH_ENTITIES=1000 \
  bun scripts/e2e/run-with-stack.ts \
  cargo test --release -p pepys-host throughput -- --ignored --nocapture
```

The bench is the ignored test in [`throughput.rs`](../../crates/host/src/e2e/throughput.rs). Its
header lists the variables.

## Results

[results.md](results.md) holds the setup, every run and the full untested list.

## Untested

[Untested](results.md#untested).
