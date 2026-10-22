# Spike: LEAF-IR under Bun

The embedding job runs LEAF-IR locally on the CPU. This spike checks that the model runs from Bun at
a usable speed before the embedding job is built.

## Question

Does LEAF-IR run under Bun through `@huggingface/transformers` and its ONNX runtime, and how long
does one embedding take on the k3s server?

## Method

1. Load LEAF-IR through `@huggingface/transformers` in a Bun script.
2. Embed 100 email texts and 20 short queries, and time each.
3. Rank the emails for each query by cosine similarity and inspect the top results by hand.

## Passes when

The model loads and embeds under Bun on the server's CPU, and a day of the owner's email embeds in
minutes.
