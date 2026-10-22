# Search

pepys answers plain-text questions over the owner's data by running two searches and merging them.
Full-text search finds exact terms, such as a ticket key, an error string or a commit SHA. Vector
search over LEAF-IR embeddings finds text that means the same thing with different words. Reciprocal
rank fusion merges the two ranked lists. The same search serves people, scripts, agents, and the
candidate step of link judgement.

## Embeddings

LEAF-IR is a small retrieval model built for short queries against longer documents, and it runs on
the CPU, so pepys embeds text locally. The embedding job in [enrichment](./enrichment.md) embeds
each extracted email text and each pull request and issue text, and writes each vector as a fact. A
consumer projects the vectors into a Turso table.

A question gets embedded with the same model, and the nearest vectors are the candidates. Turso's
exact vector search is fast enough at the volume one person produces, so pepys needs no approximate
index.

## Full-text search

Turso builds full-text indexes with tantivy and ranks matches with BM25. A consumer owns the index
over the same texts the embedding job reads.

## Hybrid ranking

The two searches fail in opposite ways. A paraphrase defeats full-text search, and an exact
identifier defeats vector search. Running both and merging the rankings with reciprocal rank fusion
keeps both strengths, and it needs no score calibration between the two engines, because it uses
only each result's rank.

## Link candidates

Link judgement needs candidate pairs, since Jev judges pairs and never finds them. Hybrid search
proposes them: the emails nearest to an issue's text within a time window, for example. Jev then
judges only the top candidates, which keeps model calls to a small fraction of all possible pairs.

## Open questions

The [LEAF-IR spike](./spikes/leaf-ir-bun/README.md) checks that the model runs under Bun. The
[Turso spike](./spikes/turso-bindings/README.md) checks how stable Turso's full-text search is.
