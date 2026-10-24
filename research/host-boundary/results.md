# Host boundary: results

The spike passes: three of the four boundary shapes run the attested consumer from a Rust wasmtime
embedding and match Bun on 8 of 8 inputs, with both WASI clocks bound to time 0. The recommended
shape is a core module whose read is a scalar host import followed by a host write into the
consumer's memory. The [README](README.md) holds the question and the answer.

## Method

The [scriptc spike](../scriptc-wasm/README.md) found that scriptc emits a WASI preview 1 core
module, that its host imports return only numbers, and that a string result through a component
needs a hand-written bridge. This spike settles the boundary's shape on that consumer.

1. Embed wasmtime in a small Rust program and bind the WASI clock to a constant there.
2. Run the scriptc spike's attested consumer as a core module, passing the fact in and the
   operations out through memory the module exports.
3. Wrap the same consumer as a component with a WIT world, and run it through the embedding.
4. Serve one row read each way: a scalar host import that the host follows by writing the row into
   module memory, and rows that the host prefetches into the input.
5. For each shape, record what glue it needs and whether a generator could write that glue from the
   schema.

The spike passes when one shape runs the consumer from the Rust embedding with the clock bound to a
constant, serves a row read, returns operations equal to Bun's on the scriptc spike's inputs, and
needs only glue a generator can write. The result records that shape.

## Setup

The spike ran on wasmtime 49.0.3 from Rust, scriptc 0.3.5, zig 0.16.0 and wasm-tools 1.262.0, on one
x86_64 WSL2 host. Download zig, wasm-tools and the wasmtime 49.0.3 preview 1 adapters, check each
SHA-256, and run from this folder:

```bash
PEPYS_ZIG_BIN=<zig binary> PEPYS_WASM_TOOLS_BIN=<wasm-tools binary> PEPYS_WASI_ADAPTER_DIR=<adapter directory> bun run check
```

The runner exits 0 on a pass. The Rust host is its own Cargo workspace, in [Cargo.toml](Cargo.toml)
and [src](src/), and Cargo builds it into the temp directory. About 20 of its transitive crates are
pinned to older releases, so that every crate is at least 7 days old. The WIT world is in
[wit](wit/).

## Shapes

The library attests `deterministic: true`, and the Rust host binds both WASI clocks to time 0
through `WasiCtxBuilder`, which every run reads once. Per input is instantiation plus the call,
after a 36 to 43 ms compile. Each glue piece is a fixed template per read or per export, which a
generator can write.

| Shape                   | From Rust | Glue                                                       | Per input     | Failure mode                    |
| ----------------------- | --------- | ---------------------------------------------------------- | ------------- | ------------------------------- |
| core module, host write | 8 of 8    | 2 `func_wrap` imports, alloc and out-slots                 | 0.1 to 3.4 ms | short write breaks `JSON.parse` |
| core module, prefetch   | 8 of 8    | alloc and out-slots                                        | 0.1 to 3.3 ms | keys must be known first        |
| component, prefetch     | 8 of 8    | WAT bridge, `cabi_realloc`, 3 wasm-tools steps, `bindgen!` | 0.1 to 3.3 ms | keys must be known first        |
| component, host write   | 2 of 8    | the same                                                   | none          | the host writes into a copy     |

## The recommended shape

The core module with a scalar read and a host write into memory is the only passing shape in which
the consumer reads from the host during the call, as the consumer design describes. Prefetch needs
every read key before the call, which no schema declares.

The component host-write shape fails by design: the canonical ABI copies a `list<u8>` parameter, so
the row never reaches the consumer. Its `JSON.parse` then panics on the 6 inputs that read a review.

## Risks

The core shape relies on scriptc passing a `bytes` callback parameter as a view of its memory, which
scriptc documents only as borrowed for the call. Boundary tests therefore gate each scriptc upgrade.
Each read costs two host calls.

scriptc 0.3.5 segfaults (exit 139) on `Reflect.get` of a parsed value in this entry, so the row
narrows with `in`.

## Untested

- Reads of a fact range, an entity's facts or a blob.
- A row that changes between the two host calls of one read.
- One instance kept across inputs.
- wasmtime 50.x and scriptc 0.3.6.
- Machines other than x86_64 WSL2.
