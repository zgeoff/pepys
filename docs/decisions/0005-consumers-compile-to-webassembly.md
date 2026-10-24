# 0005: Consumers compile to WebAssembly with scriptc

Date: 2026-10-22 Updated: 2026-10-24

## Decision

Consumers are written in TypeScript and compiled by scriptc to WebAssembly modules, which the host
runs in wasmtime with no network or random imports and with the clock bound to a constant. Every
consumer builds with scriptc's `determinism.fences` on every ambient API, and its build fails unless
scriptc attests the module deterministic. scriptc is the only compiler. A consumer that uses
something outside scriptc's subset changes to fit it.

## Rejected alternatives

| Option                            | Why not                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| plain TypeScript in a Bun process | purity rests on discipline, and nothing stops a consumer calling the network |
| jco or ComponentizeJS             | the owner chose scriptc and accepts its experimental status                  |
| consumers written in Rust         | slower to write and change for logic that changes often                      |
| a module with no clock import     | scriptc's runtime imports the clock and reads it at startup                  |

## Why

Denying the network and random imports keeps those sources of nondeterminism out of every consumer.
The `determinism.fences` entries refuse the clock, random and process APIs in the consumer's own
code at compile time, and the constant clock covers the read in scriptc's runtime. A consumer's only
other inputs are the facts, rows and content-addressed blobs the host gives it. The sandbox also
lets the host enforce ownership on every write. WebAssembly is the boundary, so a later compiler or
language can replace scriptc per consumer without changing the host.

## Changes

- 2026-10-24: the host binds the clock to a constant instead of denying it, and every consumer
  builds with `determinism.fences` and attests deterministic, because the
  [scriptc spike](../../research/scriptc-wasm/README.md) found that scriptc's runtime reads the
  clock at startup.
