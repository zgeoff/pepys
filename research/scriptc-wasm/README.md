# Scriptc to WebAssembly

Consumers are TypeScript compiled by scriptc to WebAssembly and run by the host in wasmtime with no
network or random imports and the WASI clock bound to a constant. This spike proves that path on a
real consumer before the first consumer package depends on it.

## Question

Can scriptc compile a pure consumer that uses regular expressions and JSON to a WASI module that
wasmtime runs with every import denied, and does the module return the same operations as the same
function run under Bun?

## Method

1. Write the review-link derivation as a pure function over inline findings, commits and reviews.
2. Run `scriptc coverage` on it and record what the subset rejects.
3. Build it with scriptc for the WASI target.
4. List the module's imports, and run it under wasmtime with the clock and random imports denied.
5. Run the same function under Bun on the same input and compare the operation lists.

## Passes when

The module imports no random or network function, and its operation list equals the Bun run's for
every input with the clock bound to a constant, either ENOSYS or time 0. The library build under the
full `determinism.fences` list attests `deterministic: true`.

## Run

Download zig 0.16.0, whose clang matches the runtime pack, wasm-tools 1.262.0, and wasmtime 49.0.3
with its preview 1 adapters, check each SHA-256, and run from this folder:

```bash
PEPYS_ZIG_BIN=<zig binary> PEPYS_WASMTIME_BIN=<wasmtime binary> PEPYS_WASM_TOOLS_BIN=<wasm-tools binary> PEPYS_WASI_ADAPTER_DIR=<adapter directory> bun run check
```

The runner exits 0 when the check passes. The wasmtime CLI cannot bind one WASI preview 1 function,
so `--preload` fills the clock and random imports with functions that return ENOSYS, write time 0,
or trap. The root package trusts the `scriptc` postinstall script.

## Result

The spike passes. The module imports `clock_time_get` and reads the monotonic clock at startup,
which a rule of no clock import would refuse.

- Output: scriptc 0.3.5 emits a 449 KB WASI preview 1 core module, not a component.
- Imports: 13, with no random, poll or socket import. A trapping clock traps all 8 runs.
- Equality: on all 8 inputs, stdout, stderr and exit code equal Bun's byte for byte, under the real,
  ENOSYS and zero clocks.
- Time: 4 to 12 ms per precompiled run, 8 to 18 ms per Bun run (0.1 to 7 ms in the function).

With `determinism.fences` on the Date, performance, process, random, filesystem and OS ids, the
library build's sidecar attests `deterministic: true`, and a scratch `Date.now()` fails it (SC4008).
The reactor still reads the clock at initialization. Its host import, a stand-in for the WIT `get`,
matches Bun on all 8 inputs under the ENOSYS clock. A host import returns only a scalar.

wasm-tools wraps the module with the command adapter into a 485 KB component that matches Bun on all
8 inputs and imports both WASI clocks. A custom WIT world with one host import and a string export
wraps too and matches Bun on the 7 inputs short enough for `--invoke`.

All 109 statements compile statically after three reshapes. type-fest's `Tagged` blocks the build
even as a type-only import (SC2013), so the IDs use a local brand. A `flatMap` callback that returns
`value ?? []` blocks (SC1090). `match.groups` lowers only in a `for…of` over `matchAll` (SC2020).

## Untested

- Binding the clock from a Rust wasmtime embedding: only the CLI preload binds it here.
- An attestation outside the library contract shape: the sidecar came only from a model record, a
  kind-tagged message union, and init and update exports.
- WIT host calls backed by real rows, scriptc 0.3.6 or 0.4.x, and other machines than x86_64 WSL2.
