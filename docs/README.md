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
