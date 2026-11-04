# LEAF-IR under Bun: results

The spike is partial. On a development PC, Bun 1.4.3 loads `MongoDB/mdbr-leaf-ir` through
`@huggingface/transformers` 4.3.2 and the native `onnxruntime-node` 1.30.0 binding, reproduces the
model card's scores, and embeds one email in milliseconds. The pass check names the server's CPU and
a day of the owner's email, and neither was measured: the k3s server was unreachable, and the
owner's daily volume is unknown. The [README](README.md) holds the question and the answer.

## Method

1. Load LEAF-IR through `@huggingface/transformers` in a Bun script.
2. Embed 100 email texts and 20 short queries, and time each.
3. Rank the emails for each query by cosine similarity and inspect the top results by hand.

The spike passes when the model loads and embeds under Bun on the server's CPU, and a day of the
owner's email embeds in minutes.

The runner adds three checks to the method. It embeds the model card's Transformers.js example and
fails when an fp32 score differs from the card's by more than 0.001. It fails when no native ONNX
runtime library is mapped into the process, because then the WASM backend ran. It also embeds each
email alone and in batches of 16, and reports the lowest cosine between the two vectors.

## Setup

The model is [`MongoDB/mdbr-leaf-ir`](https://huggingface.co/MongoDB/mdbr-leaf-ir) at revision
`4262131b32c3182bd06e67e92ae69d7bd66e0c5c`, a 23M-parameter BERT encoder with mean pooling, a dense
layer from 384 to 768 dimensions and normalization. The repo ships `onnx/model.onnx` and fp16, q4,
q4f16 and q8 variants, and its model card gives a Transformers.js example. The card's
`sentence_embedding` output includes the dense layer and the normalization. Queries take the prefix
`Represent this sentence for searching relevant passages: ` and documents take none, as the model's
`config_sentence_transformers.json` sets.

| Part                        | Version or value                                                |
| --------------------------- | --------------------------------------------------------------- |
| Bun                         | 1.4.3, linux-x64                                                |
| `@huggingface/transformers` | 4.3.2, its `dist/transformers.node.mjs` entry                   |
| `onnxruntime-node`          | 1.30.0, the binary bundled in the npm package for linux-x64     |
| device                      | `cpu`                                                           |
| tokenizer                   | padding, truncation at 512 tokens                               |
| CPU                         | AMD Ryzen 7 9800X3D, 8 cores, 16 threads, under WSL2 on Hyper-V |
| memory                      | 30 GB                                                           |

The PC ran other agents' work at the same time, with a 1-minute load average of 6.3 to 7.9 on its 16
threads around run 4, so the timings carry that noise. The runner downloads about 111 MB of fp32 and
q8 weights into a gitignored `.cache/` beside it. `onnxruntime-node`'s install script only fetches
CUDA binaries, so Bun's blocked lifecycle script costs nothing on a CPU.

Run it from the repo root:

```bash
bun run --filter ./research/leaf-ir-bun check
```

The runner runs fp32 and then q8, prints each timing and each query's top 3, and exits non-zero when
a check fails.

### The k3s server

The PC's `~/.ssh/config` holds a host named `windrose`. Two read-only ssh probes of it, with connect
timeouts of 5 s and 10 s, timed out on port 22, so whether `windrose` is the k3s server, and its
CPU, are unknown. The owner reproduces the timing on the server with Bun 1.4.x installed:

```bash
git clone --depth 1 --branch research/leaf-ir-bun https://github.com/zgeoff/pepys /tmp/pepys-leaf && cd /tmp/pepys-leaf && bun install && bun run --filter ./research/leaf-ir-bun check && lscpu | head -20
```

The repo is public, so the clone needs no credential.

## Backend

Bun resolves the package's `node` export condition, `dist/transformers.node.mjs`, which loads
`onnxruntime-node`. After the run, `/proc/self/maps` holds `napi-v6/linux/x64/libonnxruntime.so.1`
and `napi-v6/linux/x64/onnxruntime_binding.node`, so the native runtime ran. The `env.backends.onnx`
object lists WASM keys under the native backend too, so it shows nothing about which backend ran.

## Card check

The fp32 model reproduces the card's four example scores (0.6857, 0.4598, 0.4238, 0.5723) to within
0.00005 in every run. The q8 model differs from them by up to 0.024.

## Timings

The emails run from 35 to 480 tokens, so none hits the 512-token truncation. Each timing is one call
of the tokenizer and the model, after one warm-up call. The ranges cover 6 runs, each with 3 rounds
of 100 emails, except run 1, which had one round. Run 1 also downloaded the weights. Runs 1 to 5
used earlier versions of the runner, which differ from the committed one in lint fixes, the rounds,
the backend check and the printed totals. Run 6 used the committed runner, and only run 6 printed
the total time of each round.

| Measure                              | fp32              | q8                |
| ------------------------------------ | ----------------- | ----------------- |
| load, cold cache                     | 13.7 s            | 3.6 s             |
| load, warm cache                     | 377 ms to 454 ms  | 42 ms to 90 ms    |
| one email, median of a round         | 2.9 ms to 11.0 ms | 1.6 ms to 6.4 ms  |
| one email, p95 of a round            | 7.9 ms to 29.9 ms | 3.7 ms to 18.2 ms |
| one email, slowest                   | 140.1 ms          | 64.2 ms           |
| 100 emails one at a time, run 6      | 592 ms to 836 ms  | 449 ms to 800 ms  |
| one query, median                    | 2.1 ms to 9.6 ms  | 1.4 ms to 3.6 ms  |
| one email in a batch of 16, mean     | 4.0 ms to 11.3 ms | 2.3 ms to 5.2 ms  |
| lowest cosine, batched against alone | 1.000000          | 0.989044          |

A batch pads every text to its longest one, so a batch of 16 costs more per email than one email at
a time on this CPU. The q8 graph holds 25 `DynamicQuantizeLinear` nodes, which pick a scale from the
whole input tensor, so the same email gets a different vector in a different batch.

The fp32 model with a fixed number of intra-op threads gives these medians and p95s over 100 emails:

| Threads         | Median           | p95               |
| --------------- | ---------------- | ----------------- |
| 1               | 5.6 ms to 6.8 ms | 7.6 ms to 9.3 ms  |
| 4               | 2.1 ms to 2.3 ms | 3.2 ms to 5.3 ms  |
| runtime default | 2.6 ms to 7.6 ms | 8.2 ms to 20.5 ms |

On this shared PC, four threads give the lowest and steadiest median in every run. In run 6, one
thread embeds the 100 emails in 706 ms in total. Scaled from run 6's totals, 1,000 emails like these
take 5.9 s to 8.4 s with the default threads and 7.1 s on one thread. The scaling assumes the
owner's emails match the fixtures' 35 to 480 tokens.

## Ranking

Each of the 20 queries targets one email and avoids its words where it can, such as "injections for
the dog" for a vet's booster appointment. Both models rank the target first for 19 queries and in
the top 5 for all 20. The fp32 cosine of a top hit ranges from 0.34 to 0.63.

The miss is "someone logged into my cloud storage from another country". The terms-of-service email
for the same invented storage service ranks first at 0.353 in fp32, and its text covers the
countries where the service stores data. The sign-in alert ranks second at 0.347. By hand, every
other top 3 is plausible: flight queries return the other flight and the hotel, and the CI failure
query returns two engineering digests.

## Untested

- The k3s server's CPU, and whether `windrose` is that server.
- An email longer than 512 tokens, and whether the job truncates it or embeds it in chunks.
- The owner's own mail and its daily volume, and texts in languages other than English.
- The fp16, q4 and q4f16 weights, and the `mdbr-leaf-ir-asym` model.
- Memory use, and many embeddings running at once in one process.
- An ARM CPU, and a Bun release other than 1.4.3.
