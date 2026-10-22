# 0007: The host is written in Rust, everything else in TypeScript

Date: 2026-10-22

## Decision

The host, which runs every consumer on every fact, is written in Rust and embeds wasmtime, the Turso
engine and the S2 Rust SDK. Ingest, enrichment and the API are TypeScript on Bun.

## Rejected alternatives

| Option             | Why not                                                                           |
| ------------------ | --------------------------------------------------------------------------------- |
| a TypeScript host  | runs on every fact, where Rust's speed and wasmtime's native API matter           |
| enrichment in Rust | its time goes to git, disks and networks, and its prompts and rules change weekly |

## Why

Rust goes where work runs on every fact. TypeScript goes where code mostly waits on networks and
changes often, and where the owner's lint rules, tests and tooling apply.
