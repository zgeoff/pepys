# Scriptc to WebAssembly

Consumers are TypeScript compiled by scriptc to WebAssembly and run by the host in wasmtime with no
network, clock or random imports. This spike proves that path on a real consumer before the first
consumer package depends on it.

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

The module runs under wasmtime with no clock, random or network import, and its operation list
equals the Bun run's list for every input.

## Run

Download zig 0.16.0, whose clang matches the runtime pack, wasm-tools 1.262.0, and wasmtime 49.0.3
with its preview 1 adapters, check each SHA-256, and run from this folder:

```bash
PEPYS_ZIG_BIN=<zig binary> PEPYS_WASMTIME_BIN=<wasmtime binary> PEPYS_WASM_TOOLS_BIN=<wasm-tools binary> PEPYS_WASI_ADAPTER_DIR=<adapter directory> bun run check
```

The runner exits 1 while the check fails. The wasmtime CLI cannot deny one WASI preview 1 function,
so `--preload` fills the clock and random imports with functions that trap, return ENOSYS, or write
time 0. The root package trusts the `scriptc` postinstall script.

## Result

The spike fails its check: the module imports the WASI clock and calls it on every run.

- Output: scriptc 0.3.5 emits a 449 KB WASI preview 1 core module, not a component.
- Imports: 13, with `clock_time_get` and no random, poll or socket import. The runtime reads the
  monotonic clock at startup, so the trapping clock traps all 8 runs.
- Equality: on all 8 inputs, stdout, stderr and exit code equal Bun's byte for byte, under the real,
  ENOSYS and zero clocks.
- Time: 4 to 12 ms per precompiled run, 8 to 18 ms per Bun run (0.1 to 7 ms in the function).

With `determinism.fences` on the Date, performance, process, random, filesystem and OS ids, the
library build's sidecar attests `deterministic: true`, and a scratch `Date.now()` fails it (SC4008).
The reactor still imports the clock and reads it at initialization. Its host import, a stand-in for
the WIT `get`, matches Bun on all 8 inputs under the ENOSYS clock. A host import returns only a
scalar, and the sidecar needs a model and message contract.

wasm-tools wraps the module with the command adapter into a 485 KB component that matches Bun on all
8 inputs, and maps the clock to both WASI monotonic and wall clocks. A custom WIT world with one
host import and a string export also wraps, given a hand-written bridge for the string result. With
a composed host that answers 42, it matches Bun on the 7 inputs short enough for `--invoke`.

All 109 statements compile statically after three reshapes. type-fest's `Tagged` blocks the build
even as a type-only import (SC2013), so the IDs use a local brand. A `flatMap` callback that returns
`value ?? []` blocks (SC1090). `match.groups` lowers only in a `for…of` over `matchAll`, not after a
spread or through `?.` (SC2020).

## Untested

- The Rust embedding, which could link its own clock, and WIT host calls backed by real rows.
- Whether scriptc 0.3.6 or 0.4.x drops the startup clock read.
- Any machine other than one x86_64 WSL2 host.
