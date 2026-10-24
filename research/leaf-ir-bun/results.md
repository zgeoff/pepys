# LEAF-IR under Bun: results

The spike has not run. This file holds its method and the check it must pass, and the
[README](README.md) holds the question.

## Method

1. Load LEAF-IR through `@huggingface/transformers` in a Bun script.
2. Embed 100 email texts and 20 short queries, and time each.
3. Rank the emails for each query by cosine similarity and inspect the top results by hand.

The spike passes when the model loads and embeds under Bun on the server's CPU, and a day of the
owner's email embeds in minutes.

## Setup

The spike has no runner yet, and its `package.json` pins no version.

## Untested

Every step of the method, until the spike runs.
