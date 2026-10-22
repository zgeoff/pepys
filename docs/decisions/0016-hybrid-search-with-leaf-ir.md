# 0016: Hybrid search with local LEAF-IR embeddings

Date: 2026-10-22

## Decision

pepys embeds text with LEAF-IR on the CPU and stores the vectors in Turso. Search runs Turso's
full-text search and its vector search, and merges the rankings with reciprocal rank fusion.

## Rejected alternatives

| Option                  | Why not                                                         |
| ----------------------- | --------------------------------------------------------------- |
| full-text search alone  | misses text that says the same thing in other words             |
| a hosted embeddings API | LEAF-IR runs locally on the CPU, and the owner has evaluated it |

## Why

The two searches fail in opposite ways, so merging them keeps both strengths. Plain-text questions
over the owner's own data, from people and agents alike, need meaning, not only matching words.
