<div align="center">
  <h1>pepys</h1>

  <p>
    <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
  </p>

  <p>
    <a href="./docs/README.md">Documentation</a> •
    <a href="./AGENTS.md">Agent Guidelines</a>
  </p>
</div>

A personal data hub for the owner's own data.

pepys ingests data from pluggable sources as immutable facts, in a log on object storage with one
stream per fact family. Consumers compiled to sandboxed WebAssembly turn the facts into queryable
tables of entities and the links between them. pepys serves those tables through typed queries, MCP
and change streams.

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

Install Bun 1.4.4, the version that `.bun-version` pins, then run:

```sh
bun install
bun run test
```

## Checks

- `bun run typecheck`, `bun run lint` and `bun run test` are the local checks.
- CI also runs `bun run lint:full`, `bun run deadcode`, `bun run audit`, `bun run check`,
  `bun run schema:check`, the Rust checks and the e2e lanes. The Commands section of
  [AGENTS.md](./AGENTS.md) covers each. `bun run check` runs the shared chex checks: the branch's
  commit messages and local paths, the workflow lint, the test timeouts and the dependency gates.
- `bun run format` writes the formatting, and `bun run format:check` verifies it.

## Layout

- `crates/` holds the Rust crates, one folder each.
- `packages/` holds the `@pepys/*` workspace packages.
- `stack/` holds the Docker stack of s2-lite and Garage that the e2e lanes run on.
- `research/` holds the spikes, one Bun package each.
- `scripts/` holds the repo tooling.
- `docs/` holds the documentation.

## Documentation

The [docs index](./docs/README.md) lists every doc.
