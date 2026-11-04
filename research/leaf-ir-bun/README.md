# Spike: LEAF-IR under Bun

The embedding job runs LEAF-IR locally on the CPU. This spike loads the model from Bun, checks its
vectors against the model card and times one embedding, for the search design, before the embedding
job is built.

## Question

Does LEAF-IR run under Bun through `@huggingface/transformers` and its ONNX runtime, and how long
does one embedding take on the k3s server?

## Answer

- The spike is partial: it ran on a development PC, and the k3s server run is blocked, because ssh
  could not reach the server.
- `MongoDB/mdbr-leaf-ir` ships ONNX weights, and Bun 1.4.3 runs them through the native
  `onnxruntime-node` binding, with fp32 scores within 0.00005 of the model card's.
- On an AMD Ryzen 7 9800X3D shared with other work, one email embeds in 3 ms to 11 ms at the median
  in fp32. Scaled from measured totals, 1,000 similar emails take 6 s to 9 s.
- For 19 of 20 invented queries the intended email ranks first, and for all 20 it ranks in the
  top 5.
- The q8 weights take 2.3 ms to 5.2 ms an email in a batch against fp32's 4.0 ms to 11.3 ms, but a
  q8 vector changes with its batch, by a cosine as low as 0.989.

Use LEAF-IR fp32 through `@huggingface/transformers` in the embedding job, and rerun this spike on
the k3s server before the job is sized.

## Run it

```bash
bun run --filter ./research/leaf-ir-bun check
```

The model revision, the versions and the command for the k3s server are in
[Setup](results.md#setup).

## Results

[results.md](results.md) holds the backend check, the card check, every timing and each query's
ranking.

## Untested

The k3s server's CPU, emails longer than 512 tokens, and the owner's own mail:
[Untested](results.md#untested).
