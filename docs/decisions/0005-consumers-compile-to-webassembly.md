# 0005: Consumers compile to WebAssembly with scriptc

Date: 2026-10-22

## Decision

Consumers are written in TypeScript and compiled by scriptc to WebAssembly modules, which the host
runs in wasmtime with no network, clock or random imports. scriptc is the only compiler. A consumer
that uses something outside scriptc's subset changes to fit it.

## Rejected alternatives

| Option                            | Why not                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| plain TypeScript in a Bun process | purity rests on discipline, and nothing stops a consumer calling the network |
| jco or ComponentizeJS             | the owner chose scriptc and accepts its experimental status                  |
| consumers written in Rust         | slower to write and change for logic that changes often                      |

## Why

A module with no outside imports cannot break replay: it gives the same output for the same facts by
construction. The sandbox also lets the host enforce ownership on every write. WebAssembly is the
boundary, so a later compiler or language can replace scriptc per consumer without changing the
host.
