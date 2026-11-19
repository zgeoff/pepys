# Host throughput: results

The [README](README.md) holds the question and the answer. Every figure is one run, read once, with
no repeat, so treat a difference under about 20 % as noise.

## Method

The bench seeds one stream of one consumer on a basin of its own, in appends of 1000 facts, then
times one `up` of the consumer from an empty store folder. `up` reads the stream in batches of 100
facts, the `BATCH_SIZE` in [`commands.rs`](../../crates/host/src/commands.rs), applies each batch in
one transaction, and swaps the new version in. The timer covers the whole `up`: opening the version,
reading from s2-lite, the module calls and the writes.

Each run varies the number of facts and the number of entities, with the facts spread over the
entities round robin:

- `logbook_voyage` is a fact-mode consumer, from the e2e deployment. Each fact is one voyage with an
  entity of its own, so it writes one row.
- `ledger_account` is a scope-mode consumer, from the stub deployment. The first fact of an entity
  opens an account, and each later fact posts an entry, which is one row and one link. An entity is
  a scope, so `facts / entities` is the length of each scope.

Time per batch is the time of the `up` divided by the number of batches, so it is an average over a
scope that grows from 0 to its full length. The time of the batches between two sizes of one scope
comes from the difference of the two runs.

## Setup

| Item      | Value                                                                             |
| --------- | --------------------------------------------------------------------------------- |
| Machine   | AMD Ryzen 7 9800X3D, 8 cores and 16 threads, 31 GB RAM                            |
| OS        | Arch Linux on WSL2, kernel 6.6.87.2-microsoft-standard-WSL2                       |
| Commit    | `c30b42d21b2aa6f23297d473c762f2aced39d174`, with the bench of this spike on top   |
| Toolchain | rustc 1.99.1, `--release` profile of the workspace                                |
| s2-lite   | `ghcr.io/s2-streamstore/s2:0.43.2`, with Garage v2.5.0, from `stack/compose.yaml` |
| Tools     | zig 0.16.0 and wasm-tools 1.262.0, for `bun run consumers:build`                  |
| Host      | the `up` function of `pepys-host`, called in the test process, on a local s2-lite |

s2-lite, Garage and the host shared the machine, so the numbers hold no network latency.
`bun scripts/e2e/run-with-stack.ts` starts the stack for one command and removes it after.

To repeat a run, set the three bench variables and run the command in the
[README](README.md#run-it). The bench prints the seed time and the `up` time.

## Fact mode

| Facts  | `up` time | Facts per second |
| ------ | --------- | ---------------- |
| 1000   | 0.43 s    | 2336             |
| 10000  | 2.44 s    | 4091             |
| 100000 | 25.74 s   | 3885             |

The first row carries the fixed cost of opening the version. From 10000 facts the rate holds at
about 4000 facts per second, which is about 25 ms per batch of 100.

## Scope mode, many short scopes

Each scope holds 10 facts.

| Facts  | Scopes | `up` time | Facts per second |
| ------ | ------ | --------- | ---------------- |
| 1000   | 100    | 0.79 s    | 1273             |
| 10000  | 1000   | 6.49 s    | 1540             |
| 100000 | 10000  | 64.95 s   | 1540             |

The rate holds at 1540 facts per second to 100000 facts, which is about 65 ms per batch. A batch of
100 facts holds about 100 scopes here, and the host calls the module once for each.

## Scope mode, scope length

One scope, with the batches of 100 facts all landing in it:

| Facts in the scope | `up` time | Time per batch, averaged |
| ------------------ | --------- | ------------------------ |
| 100                | 0.18 s    | 179 ms                   |
| 1000               | 0.69 s    | 69 ms                    |
| 2000               | 2.83 s    | 142 ms                   |
| 5000               | 31.45 s   | 629 ms                   |
| 10000              | 230.66 s  | 2307 ms                  |

The 100-fact row is one batch, and its time is the fixed cost of an `up` plus one batch. The batches
between two sizes take the average time below. The time per batch rises faster than the scope
length:

| Scope grows from | Time per batch, averaged | Scope length at the middle |
| ---------------- | ------------------------ | -------------------------- |
| 1000 to 2000     | 214 ms                   | 1500                       |
| 2000 to 5000     | 953 ms                   | 3500                       |
| 5000 to 10000    | 3984 ms                  | 7500                       |

Time per batch grows 4.5 times from a scope of 1500 to one of 3500, which is 2.3 times longer, and
4.2 times from 3500 to 7500, which is 2.1 times longer. The cause is not measured: the host reads
and replaces the whole scope in every batch, and no run profiled which part, the module, the rewrite
of the rows or the index, grows fastest.

The same 10000 facts at several scope lengths:

| Scopes | Facts per scope | `up` time | Facts per second |
| ------ | --------------- | --------- | ---------------- |
| 1000   | 10              | 6.49 s    | 1540             |
| 100    | 100             | 26.85 s   | 372              |
| 10     | 1000            | 41.94 s   | 238              |
| 1      | 10000           | 230.66 s  | 43               |

## The binary

`target/release/pepys up ledger_account` on a stream of 10000 facts over 1000 scopes took 6.92 s by
`time`, against 6.49 s in the bench. The bench measures what the binary does.

## Defects

No run crashed, and `up` finished every run. The bench reads no rows, so it does not check them. A
scope of 10000 facts is the one result that makes a plausible deployment unusable: a replay of one
such scope takes almost 4 minutes. No fix is small, because the host recomputes the scope in each
batch by design. The scope length limit is open, and
[host.md](../../docs/architecture/consumers/host.md#limits) states it.

## Untested

- Several runs of each case, so the spread of each figure is unknown.
- The `run` task, which applies new facts one poll at a time, and the time of one batch at a given
  scope length on a version that is already current.
- A scope of 100000 facts, a scope-mode stream of 100000 facts over fewer than 10000 scopes, and the
  cause of the growth in time per batch.
- The two-stream dock consumer and the GitHub consumers, and facts with larger payloads.
- Memory use, the size of the consumer file, and an S2 on another machine.
- A deployment with several consumers running at once.
