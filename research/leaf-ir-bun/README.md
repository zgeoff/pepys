# Spike: LEAF-IR under Bun

The embedding job runs LEAF-IR locally on the CPU. This spike times the model from Bun on the k3s
server, for the search design, before the embedding job is built.

## Question

Does LEAF-IR run under Bun through `@huggingface/transformers` and its ONNX runtime, and how long
does one embedding take on the k3s server?

## Answer

- The spike has not run, so it holds no verdict and no numbers.

The search design holds no recommendation from this spike until it runs.

## Results

[results.md](results.md) holds the method and the check the spike must pass.

## Untested

Every step of the method, until the spike runs: [Untested](results.md#untested).
