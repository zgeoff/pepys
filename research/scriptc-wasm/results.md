# Scriptc to WebAssembly: results

The spike passes on scriptc 0.3.5. The module imports `clock_time_get` and reads the monotonic clock
at startup, which a rule of no clock import would refuse. With the clock bound to a constant, its
output equals Bun's byte for byte on all 8 inputs. The [README](README.md) holds the question and
the answer.

## Method

1. Write the review-link derivation as a pure function over inline findings, commits and reviews.
2. Run `scriptc coverage` on it and record what the subset rejects.
3. Build it with scriptc for the WASI target.
4. List the module's imports, and run it under wasmtime with the clock and random imports denied.
5. Run the same function under Bun on the same input and compare the operation lists.

The spike passes when the module imports no random or network function, and its operation list
equals the Bun run's for every input with the clock bound to a constant, either ENOSYS or time 0.
The library build under the full `determinism.fences` list must also attest `deterministic: true`.

## Setup

The spike ran on scriptc 0.3.5, zig 0.16.0, wasm-tools 1.262.0 and wasmtime 49.0.3, on one x86_64
WSL2 host. Download zig 0.16.0, whose clang matches the runtime pack, wasm-tools, and wasmtime with
its preview 1 adapters, check each SHA-256, and run from this folder:

```bash
PEPYS_ZIG_BIN=<zig binary> PEPYS_WASMTIME_BIN=<wasmtime binary> PEPYS_WASM_TOOLS_BIN=<wasm-tools binary> PEPYS_WASI_ADAPTER_DIR=<adapter directory> bun run check
```

The runner exits 0 when the check passes. The wasmtime CLI cannot bind one WASI preview 1 function,
so `--preload` fills the clock and random imports with functions that return ENOSYS, write time 0,
or trap. The root `package.json` trusts the `scriptc` postinstall script, so its compiler installs.

## Command module

- Output: scriptc 0.3.5 emits a 449 KB WASI preview 1 core module, not a component.
- Imports: 13, with `clock_time_get` and no random, poll or socket import. The runtime reads the
  monotonic clock at startup, so a trapping clock traps all 8 runs.
- Equality: on all 8 inputs, stdout, stderr and exit code equal Bun's byte for byte, under the real,
  ENOSYS and zero clocks.
- Time: 4 to 12 ms per precompiled run, 8 to 18 ms per Bun run (0.1 to 7 ms in the function).

## Library build

With `determinism.fences` on the Date, performance, process, random, filesystem and OS ids, the
library build's sidecar attests `deterministic: true`, and a scratch `Date.now()` fails it at
compile time (SC4008). The reactor still imports the clock and reads it at initialization.

Its host import, a stand-in for the WIT `get`, matches Bun on all 8 inputs under the ENOSYS clock. A
host import returns only a scalar, so a `get` that returns a row needs another shape. The
[host boundary spike](../host-boundary/README.md) picks that shape.

## Components

wasm-tools wraps the module with the command adapter into a 485 KB component that matches Bun on all
8 inputs, and maps the clock to both the WASI monotonic and wall clocks.

A custom WIT world with one host import and a string export also wraps, given a hand-written bridge
in WAT for the string result. With a composed host that answers 42, it matches Bun on the 7 inputs
short enough for `--invoke`.

## The scriptc subset

All 109 statements compile statically after three reshapes:

- type-fest's `Tagged` blocks the build even as a type-only import (SC2013), so the IDs use a local
  brand.
- A `flatMap` callback that returns `value ?? []` blocks the build (SC1090).
- `match.groups` lowers only in a `for…of` over `matchAll`, not after a spread or through `?.`
  (SC2020).

## Untested

- Binding the clock from a Rust wasmtime embedding: only the CLI preload binds it here. The
  [host boundary spike](../host-boundary/README.md) binds it from Rust.
- An attestation outside the library contract shape. The sidecar came only from a model record, a
  kind-tagged message union, and init and update exports, and needs that model and message contract.
- WIT host calls backed by real rows.
- Whether scriptc 0.3.6 or 0.4.x drops the startup clock read.
- Any machine other than one x86_64 WSL2 host.
