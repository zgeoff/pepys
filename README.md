<div align="center">
  <h1>pepys</h1>

  <p>
    <a href="./docs/README.md">Documentation</a> •
    <a href="./AGENTS.md">Agent Guidelines</a>
  </p>
</div>

A personal data hub that keeps every change to your own data as an immutable fact.

pepys ingests the owner's GitHub and Gmail data, builds entities and cross-source links from the
facts, and serves them through typed queries, MCP, and change streams. The first question it covers
is what is waiting on me, across everything. The repo holds the scaffold only so far: no packages
exist yet.

## Quick start

```sh
bun install
bun run test
```

Bun 1.4.3 is the pinned version (`.bun-version`).

## Checks

- `bun run typecheck` and `bun run lint` are the local checks.
- `bun run lint:full`, `bun run deadcode`, `bun run audit`, and `bun run check` run in CI.
- `bun run format` writes the formatting, and `bun run format:check` verifies it.

## Layout

- `packages/` holds the `@pepys/*` workspace packages.
- `scripts/` holds the repo tooling.
- `docs/` holds the documentation.

## Documentation

The [docs index](./docs/README.md) lists every doc.
