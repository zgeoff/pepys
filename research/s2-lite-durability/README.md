# S2-lite durability

The log runs on s2-lite with its data in Garage, and every projection depends on the log keeping
what it acknowledged. This spike checks that claim and the S2 features the design uses, before
ingest writes real facts.

## Question

Does s2-lite keep every acknowledged append when its pod dies mid-write, and does it offer unlimited
retention, a cheap read of a stream's last record, and conditional appends?

## Method

1. Run s2-lite on k3s against a Garage bucket.
2. Append numbered records from a client in a loop, and record each acknowledged sequence number.
3. Kill the s2-lite pod during the loop, then start it again.
4. Read the stream back and compare it with the acknowledged sequence numbers.
5. Check the retention settings, the tail read, and the append conditions in the S2 API.

## Passes when

Every acknowledged record survives the kill in order with no gaps, and retention can be set to keep
records forever.

## Run

The owner chose local Docker containers over k3s. The runner starts a single-node Garage, creates
its bucket and key, and points s2-lite at it. Eight appenders send one record per append with no
client retry while the runner sends SIGKILL to the s2-lite container 5 times. Each run removes its
own compose project on any exit, a signal included, and exits non-zero when a check fails.

```bash
bun run --filter ./research/s2-lite-durability check
```

## Result

The spike passes on s2-lite 0.43.2, Garage v2.4.1, `@s2-dev/streamstore` 0.29.0 and Bun 1.4.3.

**Durability:** over 11 runs of 5 kills each, s2-lite acknowledged 3,760 to 3,800 appends per run,
and the read after the last restart returns every one at its acknowledged sequence number. The
stream holds no gap, no duplicate and no record the client never sent. In 5 runs, s2-lite reports
healthy 1.4 s to 1.8 s after `docker start`, with 1 s of that spent locking out the killed instance.

**Unacknowledged appends:** an append that fails can still be stored. In 1 of the 11 runs, 8 of the
24 appends that were in flight when a kill began, and then failed, are in the stream. The other 10
runs store none of their failed appends.

**Latency:** an append takes 51.0 ms to 51.2 ms at the median and 52.4 ms to 56.1 ms at p99, with 8
in flight. The flush interval is 50 ms, the SlateDB default that s2-lite sets for a bucket and that
the startup log prints, so each append waits for one write-ahead log flush to Garage.

**Retention:** `retentionPolicy: { infinite: {} }` keeps records until a trim. The spike sets it at
stream creation, by a reconfigure, and through a basin's default stream config, and all three
survive the kills. A stream created with no config gets 7 days (`ageSecs: 604800`), so every pepys
stream needs infinite retention set explicitly or through its basin.

**Tail read:** `checkTail` answers in 0.4 ms at the median and 2 ms at worst over 50 calls, and its
tail matches the records read back.

**Conditional appends:** an append with `matchSeqNum` equal to the tail succeeds, and a stale one
fails with `SeqNumMismatchError` naming the current tail. An `AppendRecord.fence` command record
sets the stream's `fencingToken`. A wrong token fails with `FencingTokenMismatchError` and the token
holds after the kills, while an append with no token succeeds.

## Untested

- a pod kill on k3s, the real Garage deployment, its disks, and the network between them
- a crash of Garage itself, its fsync settings, and a node or disk loss
- append sessions, batches of several records, the owner's volume, and records kept past 7 days
