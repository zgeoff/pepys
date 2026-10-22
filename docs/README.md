<div align="center">
  <h1>pepys documentation</h1>

  <p>How pepys is designed, built, and run.</p>

  <p>
    <a href="../README.md">README</a> •
    <a href="../AGENTS.md">Agent Guidelines</a>
  </p>
</div>

## Design

- [pepys design](./design/pepys/README.md) — the principles, the pipeline, and the index of design
  docs and spikes.
- [Storage](./design/pepys/storage.md) — Garage, the buckets, and blobs.
- [Log](./design/pepys/log.md) — streams, the fact envelope, fact IDs, cursors, events and
  observations.
- [Ingest](./design/pepys/ingest.md) — GitHub App webhooks and Gmail history polling.
- [Entities](./design/pepys/entities.md) — per-source tables, the shared view, aliases and people.
- [Consumers](./design/pepys/consumers.md) — WebAssembly consumers, the host contract and input
  modes.
- [Host](./design/pepys/host.md) — batches, scheduling, consumer versions, preview and up.
- [Store](./design/pepys/store.md) — Turso files, attach, and Kysely queries.
- [Links](./design/pepys/links.md) — link tables, extractors, typed links and retractions.
- [Enrichment](./design/pepys/enrichment.md) — git, MIME, model judgements and the job model.
- [Search](./design/pepys/search.md) — LEAF-IR embeddings and hybrid ranking.
- [API](./design/pepys/api.md) — the query catalog, MCP, auth and agent writes.
- [Change feed](./design/pepys/change-feed.md) — the change log and the Durable Streams protocol.
- [History](./design/pepys/history.md) — transitions, past states and the Parquet lake.

## Decisions

- [0001: Object storage holds all durable state](./decisions/0001-object-storage-holds-all-state.md)
- [0002: s2-lite runs the log](./decisions/0002-s2-lite-runs-the-log.md)
- [0003: One stream per fact family](./decisions/0003-one-stream-per-fact-family.md)
- [0004: Events first, observations only to resync](./decisions/0004-events-first.md)
- [0005: Consumers compile to WebAssembly with scriptc](./decisions/0005-consumers-compile-to-webassembly.md)
- [0006: Consumers return operations, and the host applies them](./decisions/0006-consumers-return-operations.md)
- [0007: The host is written in Rust, everything else in TypeScript](./decisions/0007-rust-host.md)
- [0008: No workflow engine](./decisions/0008-no-workflow-engine.md)
- [0009: The store is Turso, one file per consumer](./decisions/0009-turso-store.md)
- [0010: The API queries with Kysely through its own Turso dialect](./decisions/0010-kysely-for-api-queries.md)
- [0011: Per-source entity tables with a shared view](./decisions/0011-per-source-entity-tables.md)
- [0012: Stable IDs from source database IDs, with aliases](./decisions/0012-stable-ids-and-aliases.md)
- [0013: Deletions become tombstones](./decisions/0013-tombstones.md)
- [0014: Link consumers split by extraction method](./decisions/0014-links-by-extraction-method.md)
- [0015: Enrichment runs in TypeScript and calls hosted models](./decisions/0015-enrichment-in-typescript-with-hosted-models.md)
- [0016: Hybrid search with local LEAF-IR embeddings](./decisions/0016-hybrid-search-with-leaf-ir.md)
- [0017: The change feed lives in the store and speaks Durable Streams](./decisions/0017-change-feed-in-the-store.md)
- [0018: Deploys run as preview and up](./decisions/0018-preview-and-up.md)
- [0019: The lake is plain Parquet](./decisions/0019-plain-parquet-lake.md)
- [0020: One API process on Elysia v2, oRPC and MCP](./decisions/0020-api-stack.md)
- [0021: Rust tooling](./decisions/0021-rust-tooling.md)
