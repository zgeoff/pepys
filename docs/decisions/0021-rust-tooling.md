# 0021: Rust tooling

Date: 2026-10-22

## Decision

Rust code uses a pinned stable toolchain on edition 2024, workspace dependencies with exact pins,
Cargo dependency cooldowns matching the TypeScript release-age rule, rustfmt, clippy with pedantic
and selected restriction lints, cargo-shear, cargo-deny, cargo-nextest with a separate doctest run,
insta, turmoil and bacon. The wild linker speeds up development builds, and release builds use the
default linker.

## Rejected alternatives

| Option                  | Why not                                            |
| ----------------------- | -------------------------------------------------- |
| the Cranelift backend   | still needs a nightly toolchain                    |
| cargo-machete           | matches with regular expressions and misses usages |
| cargo-udeps             | no longer works with current Cargo                 |
| wild for release builds | its maintainers aim it at development builds       |

## Why

The Rust tooling mirrors the owner's TypeScript stack: one pinned toolchain, one catalog of exact
versions, a release-age gate, a strict shared lint set, dead dependency checks, isolated tests and
inline snapshots.
