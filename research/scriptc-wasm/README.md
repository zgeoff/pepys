# Spike: Scriptc to WebAssembly

Consumers are TypeScript compiled by scriptc to WebAssembly and run by the host in wasmtime with no
network or random imports and the WASI clock bound to a constant. This spike compiles a real
consumer and compares its output with Bun's, for the decision that consumers compile to WebAssembly.

## Question

Can scriptc compile a pure consumer that uses regular expressions and JSON to a WASI module that
wasmtime runs with every import denied, and does the module return the same operations as the same
function run under Bun?

## Answer

- The spike passes on scriptc 0.3.5, which emits a 449 KB WASI preview 1 core module.
- The module imports `clock_time_get` and reads the clock at startup, so a trapping clock traps
  every run.
- With the clock bound to ENOSYS or time 0, output equals Bun's byte for byte on all 8 inputs.
- The library build under `determinism.fences` attests `deterministic: true` and refuses
  `Date.now()` at compile time.
- A host import returns only a scalar, and all 109 statements compile after three reshapes.

Bind the WASI clock to a constant in the host instead of refusing a clock import.

## Run it

```bash
PEPYS_ZIG_BIN=<zig binary> PEPYS_WASMTIME_BIN=<wasmtime binary> PEPYS_WASM_TOOLS_BIN=<wasm-tools binary> PEPYS_WASI_ADAPTER_DIR=<adapter directory> bun run check
```

Run it from this folder. The tools, versions and clock preloads are in [Setup](results.md#setup).

## Results

[results.md](results.md) holds the module, library, component and subset results.

## Untested

A clock bound from Rust, other attestation shapes, and WIT calls over real rows:
[Untested](results.md#untested).
