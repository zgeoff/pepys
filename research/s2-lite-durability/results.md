# S2-lite durability: results

The spike passes on s2-lite 0.43.2 over Garage v2.4.1: across 11 runs with 5 kills each, every
acknowledged append survives in order, with no gap and no duplicate. The [README](README.md) holds
the question and the answer.

## Method

1. Run s2-lite on k3s against a Garage bucket.
2. Append numbered records from a client in a loop, and record each acknowledged sequence number.
3. Kill the s2-lite pod during the loop, then start it again.
4. Read the stream back and compare it with the acknowledged sequence numbers.
5. Check the retention settings, the tail read, and the append conditions in the S2 API.

The spike passes when every acknowledged record survives the kill in order with no gaps, and
retention can be set to keep records forever.

## Setup

The spike ran on s2-lite 0.43.2, Garage v2.4.1, `@s2-dev/streamstore` 0.29.0 and Bun 1.4.3, in local
Docker containers. The owner chose those containers over k3s, so the kill is a SIGKILL to a
container, not a pod kill. Run it from the repo root with Docker running:

```bash
bun run --filter ./research/s2-lite-durability check
```

The runner starts a single-node Garage from [compose.yaml](compose.yaml) and
[garage.toml](garage.toml), creates its bucket and key, and points s2-lite at it. Eight appenders
send one record per append with no client retry while the runner sends SIGKILL to the s2-lite
container 5 times. Each run uses its own compose project, removes it on any exit, a signal included,
and exits non-zero when a check fails.

## Durability

Over 11 runs of 5 kills each, s2-lite acknowledged 3,760 to 3,800 appends per run, and the read
after the last restart returns every one at its acknowledged sequence number. The stream holds no
gap, no duplicate and no record the client never sent. In 5 runs, s2-lite reports healthy 1.4 s to
1.8 s after `docker start`, with 1 s of that spent locking out the killed instance.

## Unacknowledged appends

An append that fails can still be stored. In 1 of the 11 runs, 8 of the 24 appends that were in
flight when a kill began, and then failed, are in the stream. The other 10 runs store none of their
failed appends. Ingest therefore retries an append whose outcome is unknown and dedupes by fact ID.

## Latency

An append takes 51.0 ms to 51.2 ms at the median and 52.4 ms to 56.1 ms at p99, with 8 in flight.
The flush interval is 50 ms, the SlateDB default that s2-lite sets for a bucket and that the startup
log prints, so each append waits for one write-ahead log flush to Garage.

## Retention

`retentionPolicy: { infinite: {} }` keeps records until a trim. The spike sets it at stream
creation, by a reconfigure, and through a basin's default stream config, and all three survive the
kills. A stream created with no config gets 7 days (`ageSecs: 604800`), so every pepys stream needs
infinite retention set explicitly or through its basin.

## Tail read

`checkTail` answers in 0.4 ms at the median and 2 ms at worst over 50 calls, and its tail matches
the records read back.

## Conditional appends

An append with `matchSeqNum` equal to the tail succeeds, and a stale one fails with
`SeqNumMismatchError` naming the current tail. An `AppendRecord.fence` command record sets the
stream's `fencingToken`. A wrong token fails with `FencingTokenMismatchError`, and the token holds
after the kills. An append with no token succeeds.

## Untested

- A pod kill on k3s, the real Garage deployment, its disks, and the network between them.
- A crash of Garage itself, its fsync settings, and a node or disk loss.
- Append sessions and batches of several records.
- The owner's volume, and records kept past 7 days.
