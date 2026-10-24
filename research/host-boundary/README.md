# Host boundary

The host runs each consumer as a WebAssembly module built by scriptc, hands it a fact or a scope,
serves its reads, and applies the operations it returns. The
[scriptc spike](../scriptc-wasm/README.md) found that scriptc emits a WASI preview 1 core module,
that its host imports return only numbers, and that a string result through a component needs a
hand-written bridge. This spike settles the boundary's shape before the schema package generates it.

## Question

Which boundary shape lets the Rust host run an attested scriptc consumer, pass it a fact, serve its
row reads and take back its operations, with every piece of glue generated from the schema?

## Method

1. Embed wasmtime in a small Rust program and bind the WASI clock to a constant there.
2. Run the scriptc spike's attested consumer as a core module, passing the fact in and the
   operations out through memory the module exports.
3. Wrap the same consumer as a component with a WIT world, and run it through the embedding.
4. Serve one row read each way: a scalar host import that the host follows by writing the row into
   module memory, and rows that the host prefetches into the input.
5. For each shape, record what glue it needs and whether a generator could write that glue from the
   schema.

## Passes when

One shape runs the consumer from the Rust embedding with the clock bound to a constant, serves a row
read, returns operations equal to Bun's on the scriptc spike's inputs, and needs only glue a
generator can write. The result records that shape.

## Run

The spike has no runner yet.

## Result

The spike has not run.

## Untested

Every step of the method, until the spike runs.
