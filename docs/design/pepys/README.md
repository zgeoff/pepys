# pepys design

This folder holds the design of the parts of pepys that are not built yet, one doc per part, as
[Design docs](#design-docs) lists. [The architecture overview](../../architecture/overview.md)
describes the part that is built, and defines the terms these docs use, such as fact, consumer,
scope, plug-in and deployment. Where a design here and an architecture doc differ about the built
part, the architecture doc is right.

The question pepys exists to answer is "what is waiting on me, across everything?". Every part below
keeps the split that the built part keeps: facts are kept forever and never change, and everything
built from them can be deleted and rebuilt by replaying the facts. Outside calls, such as a model's
judgement, happen only in enrichment, whose results return to the log as facts, so every consumer
stays pure.

## Design docs

- [Architecture](./architecture.md): strategies, champion and challenger, buckets, and provisional
  contracts.
- [Storage](./storage.md): Garage on the owner's k3s server, the buckets, and blobs.
- [Log](./log.md): cursors, the manual and enrichment streams, and events and observations.
- [Ingest](./ingest.md): the three paths of every source, GitHub backfill, and the Gmail source.
- [Entities](./entities.md): aliases, the other GitHub kinds, Gmail entities, people and tombstones.
- [Host](./host.md): scheduling, versions that name their enrichment champions, snapshots and the
  commit socket.
- [Links](./links.md): retractions, link extractors, typed references and manual links.
- [Enrichment](./enrichment.md): git, MIME, model judgements and the job model.
- [Search](./search.md): LEAF-IR embeddings, full-text search and hybrid ranking.
- [API](./api.md): writes, search and history queries, the deployment catalog and agent writes.
- [Auth](./auth.md): the `write` scope, manual writes, the token check on change feed streams, and
  their threats.
- [Change feed](./change-feed.md): the change log and the Durable Streams read protocol.
- [History](./history.md): transitions, the fact index, and the Parquet lake.
- [Runtime](./runtime.md): the k3s workloads, images, secrets, network routes and schedules.

## Spikes

Each spike settles one open question before the work that depends on it starts. The spikes live in
[research/](../../../research/README.md), whose index says what each one answers.
