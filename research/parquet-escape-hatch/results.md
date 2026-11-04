# Parquet escape hatch: results

The spike passes in 3 of 3 runs: the pull request consumer's file, rebuilt from the Parquet copy of
its stream with s2-lite stopped, equals the file that `pepys run` built from s2-lite. The
[README](README.md) holds the question and the answer.

## Method

1. Start Garage and s2-lite in Docker, start ingest, and run `pepys up` to make the consumer's first
   version.
2. Send 250 signed webhook deliveries through ingest in three batches of 100, 100 and 50. After each
   batch, run the compaction job. Run it a fourth time with no new records.
3. Run `pepys run` until the consumer's offset reaches the stream's tail.
4. Stop the s2-lite container, and check that its port refuses connections.
5. Rebuild the consumer's file from the Parquet files alone, with the same module.
6. Compare the two files table by table.
7. Rebuild from two damaged copies of the lake: one without the second file, and one without the
   third file.

The spike passes when all of these hold:

- s2-lite refuses connections before the rebuild starts;
- the two files hold the same rows in `github_pull_request`, `offsets` and `applied_facts`;
- the two files hold the same sequence of change log operations;
- the rebuild refuses both damaged copies.

The pass check compares the change log as one flattened list of operations, because the host numbers
a change log row by the last sequence number of its batch. A file built by `pepys run` while facts
arrive splits its batches at different points than a replay of a finished log. The runner also
compares the raw change log rows, and reports that result apart from the pass check.

## Setup

The spike ran on one x86_64 WSL2 host with 16 cores, on Linux 6.6.87.2:

| Component                 | Version              |
| ------------------------- | -------------------- |
| Bun                       | 1.4.3                |
| Rust                      | 1.99.1               |
| s2-lite                   | 0.43.2               |
| Garage                    | v2.5.0               |
| `@s2-dev/streamstore`     | 0.30.0               |
| `@octokit/webhooks`       | 14.2.0               |
| `@tursodatabase/database` | 0.8.3                |
| `hyparquet-writer`        | 0.17.0, which writes |
| `parquet` crate           | 60.1.0, which reads  |
| zig                       | 0.16.0, for scriptc  |
| wasm-tools                | 1.262.0, for scriptc |

Download zig from ziglang.org and wasm-tools from its GitHub release, and check each archive's
SHA-256 against the one the release lists. Run the spike from the repo root with Docker running:

```bash
PEPYS_ZIG_BIN=<zig binary> PEPYS_WASM_TOOLS_BIN=<wasm-tools binary> bun run --filter ./research/parquet-escape-hatch check
```

The runner builds the `pepys` binary, the spike's rebuild binary and the consumer module. It starts
Garage and s2-lite through the repo's `stack/with-stack.ts`, which removes the compose project and
its volumes on every exit. It prints one JSON report, and exits non-zero when the pass check fails.

The parts of the spike:

- [run-compaction.ts](run-compaction.ts) is the compaction job. It reads the stream from the offset
  it recorded last, up to the tail it reads at the start. It writes one Parquet file per UTC day of
  the records' S2 timestamps, under `<stream>/<day>/<first>-<last>.parquet`. Then it writes the
  offset it reached to `<stream>/offset.json`. Each file has three columns: `seq_num` as INT64,
  `timestamp` as TIMESTAMP_MILLIS, and `body` as a UTF-8 string.
- [src/main.rs](src/main.rs) is the rebuild. It depends on the `pepys-host` crate by path. It reads
  every Parquet file of the stream, sorts the records by sequence number, and checks that they run
  from 0 to the recorded offset with no gap and no repeat. It then applies them in batches of 100
  with the host's `apply_batch` and the consumer module, as the host's replay does.
- [run-spike.ts](run-spike.ts) runs the method and compares the files.

The lake is a local folder, because the stack publishes no Garage S3 port to the host. The
architecture's blob store port lists a local folder as one of its adapters.

## Facts

The runner invents 12 pull requests in one repository. Delivery `n` updates pull request `n mod 12`.
Every 17th delivery repeats an earlier one with the same delivery ID, as a GitHub redelivery does.
Every 23rd delivery from the third round on is an edit whose `updated_at` is older than the pull
request's last one. The last round closes and merges the six even-numbered pull requests.

| Measure                        | Each run |
| ------------------------------ | -------- |
| deliveries sent                | 250      |
| redeliveries                   | 14       |
| distinct fact IDs              | 236      |
| records in the stream          | 250      |
| pull request rows              | 12       |
| change log operations          | 228      |
| change log rows, from the log  | 3        |
| change log rows, from the lake | 3        |

## Compaction

Each compaction run wrote one file, because every record in a run arrived on the same UTC day. The
second and third runs started from the offset the run before recorded. The fourth run wrote no file
and left the offset at 250.

| Run | Records    | File size, run 1 | File size, run 2 | File size, run 3 | Time     |
| --- | ---------- | ---------------- | ---------------- | ---------------- | -------- |
| 1   | 0 to 99    | 7,066 B          | 7,065 B          | 7,070 B          | 11–12 ms |
| 2   | 100 to 199 | 7,161 B          | 7,157 B          | 7,161 B          | 4–6 ms   |
| 3   | 200 to 249 | 4,288 B          | 4,294 B          | 4,299 B          | 3–4 ms   |
| 4   | none       | none             | none             | none             | 1 ms     |

The sizes differ between runs by a few bytes because each record's timestamp differs.

## Rebuild

In each run, the rebuild read 3 files and 250 records with s2-lite stopped. It took 1,272 ms, 1,417
ms and 1,316 ms in a debug build. That time covers reading the files, compiling the module with
wasmtime and applying the batches.

| Table or list              | Run 1 | Run 2 | Run 3 |
| -------------------------- | ----- | ----- | ----- |
| `github_pull_request` rows | equal | equal | equal |
| `offsets`                  | equal | equal | equal |
| `applied_facts`            | equal | equal | equal |
| change log operations      | equal | equal | equal |
| raw change log rows        | equal | equal | equal |

The raw change log rows were equal too, because `pepys run` started after all 250 records were in
the stream, so it read them in the same batches of 100 as the rebuild. A file built while facts
arrive would differ in its raw rows and still match in its operations.

The rebuild's `applied_facts` held 236 IDs, so it skipped the 14 redeliveries as the host does.

## Damaged lakes

| Lake                    | Rebuild result                                                             |
| ----------------------- | -------------------------------------------------------------------------- |
| without the second file | refused: `the lake has no record 100, and the next record it holds is 200` |
| without the third file  | refused: `the lake holds 200 records, below the 250 its offset records`    |

The third file holds the last records, so the gap check alone does not catch its loss. The rebuild
catches it by comparing the record count with the offset in `offset.json`.

## Host boundary

The host's `FactLog` trait is `pub(crate)`, and `pepys run`, `pepys up` and `pepys preview` build an
s2-lite reader from their settings. A Parquet reader outside the host crate therefore cannot plug
into the host's replay. The spike reaches the same result through public functions: `find_consumer`,
`open_store`, `prepare_store`, `ModuleRunner::from_file`, `apply_batch` and `checkpoint`. It copies
the host's batch size of 100 from a private constant.

## Untested

- Records from more than one UTC day in one compaction run, so a run that writes several files.
- Day partitions by the fact's own time in place of the S2 arrival timestamp.
- The lake in a Garage bucket, read through S3, in place of a local folder.
- DuckDB, or any reader other than the `parquet` crate, on the files.
- A crash of the compaction job between writing a file and writing `offset.json`. The next run
  starts from the old offset and names each file by its day's first and last record. A day whose
  records are unchanged gets the same name, so the run replaces that file. A day that gained records
  gets a second file that repeats the old file's records, and the rebuild refuses the lake. This
  case needs a design.
- A loss of s2-lite's data, in place of a stopped container.
- A rebuild through a `pepys` command, which needs a lake adapter for the fact log.
- A rebuild into a consumer's version directory with a swap, as `pepys up` does.
- A release build, and the owner's volume of facts.
- A consumer other than the pull request consumer, and a consumer in scope mode.
