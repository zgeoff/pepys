<div align="center">
  <h1>pepys</h1>

  <p>
    <a href="./docs/README.md">Documentation</a> •
    <a href="./AGENTS.md">Agent Guidelines</a>
  </p>
</div>

**WIP**

sources -> immutable fact log (one stream per fact family, on object storage) -> sandboxed WASM
consumers -> queryable tables

## Packages

- [`@pepys/kit`](./packages/kit/README.md): declare a plug-in or a deployment.
- [`@pepys/testing`](./packages/testing/README.md): test a plug-in on an in-memory store.
- [`@pepys/cli`](./packages/cli/README.md): `pepys build`, which writes each consumer's glue.
- [`@pepys/kysely-turso`](./packages/kysely-turso/README.md): a Kysely dialect for Turso.
- [`@pepys/schema`](./packages/schema/README.md): the consumer manifest types.
- [`@pepys/contract`](./packages/contract/README.md): the oRPC contract of the core queries.
- [`@pepys/ingest`](./packages/ingest/README.md): the receive routes and the fact log.
- [`@pepys/api`](./packages/api/README.md): typed queries over the store.
- [`@pepys/source-github`](./packages/source-github/README.md): the GitHub plug-in.
- [`@pepys/source-telemetry`](./packages/source-telemetry/README.md): the telemetry plug-in.

## Quick start

```sh
bun install
bun run test
```

Bun 1.4.4 is the pinned version (`.bun-version`).

## Checks

- `bun run typecheck` and `bun run lint` are the local checks.
- `bun run lint:full`, `bun run deadcode`, `bun run audit`, and `bun run check` run in CI.
  `bun run check` runs the shared chex checks: the branch's commit messages and local paths, the
  workflow lint, the test timeouts and the dependency gates.
- `bun run format` writes the formatting, and `bun run format:check` verifies it.

## Layout

- `packages/` holds the `@pepys/*` workspace packages.
- `research/` holds the spikes, one Bun package each.
- `scripts/` holds the repo tooling.
- `docs/` holds the documentation.

## Documentation

The [docs index](./docs/README.md) lists every doc.
