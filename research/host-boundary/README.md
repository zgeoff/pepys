# Spike: Host boundary

The host runs each consumer as a WebAssembly module built by scriptc, hands it a fact or a scope,
serves its reads, and applies the operations it returns. This spike runs four boundary shapes from a
Rust wasmtime embedding, to settle the boundary before the schema package generates its glue.

## Question

Which boundary shape lets the Rust host run an attested scriptc consumer, pass it a fact, serve its
row reads and take back its operations, with every piece of glue generated from the schema?

## Answer

- The spike passes on wasmtime 49.0.3: three of four shapes match Bun on 8 of 8 inputs, with the
  WASI clocks bound to 0 in Rust.
- The two prefetch shapes pass, but they need every read key before the call, which no schema
  declares.
- The component host-write shape fails by design: the canonical ABI copies the buffer.
- The core host-write shape relies on scriptc passing a buffer as a view of its memory.
- Every glue piece is a fixed template a generator can write.

Use a core module whose read is a scalar host import, then a host write into the consumer's memory.

## Run it

```bash
PEPYS_ZIG_BIN=<zig binary> PEPYS_WASM_TOOLS_BIN=<wasm-tools binary> PEPYS_WASI_ADAPTER_DIR=<adapter directory> bun run check
```

Run it from this folder. The tools, versions and checksums are in [Setup](results.md#setup).

## Results

[results.md](results.md) holds the table of shapes, the reasons for the choice, and the risks.

## Untested

Range, entity and blob reads, a row that changes mid-read, and wasmtime 50.x:
[Untested](results.md#untested).
