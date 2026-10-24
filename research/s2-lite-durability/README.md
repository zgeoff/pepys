# Spike: S2-lite durability

The log runs on s2-lite with its data in Garage, and every projection depends on the log keeping
what it acknowledged. This spike kills s2-lite during appends and checks the S2 features the log
design uses, before ingest writes real facts.

## Question

Does s2-lite keep every acknowledged append when it dies mid-write, and does it offer unlimited
retention, a cheap read of a stream's last record, and conditional appends?

## Answer

- The spike passes on s2-lite 0.43.2: over 11 runs of 5 SIGKILLs each, every acknowledged append
  survives in order.
- An unacknowledged append can still land, as 8 appends did in 1 of the 11 runs.
- A stream defaults to 7 days of retention, and `infinite` retention must be set.
- An append takes about 51 ms, from SlateDB's 50 ms flush, and `checkTail` takes 0.4 ms.
- Conditional appends on `matchSeqNum` and on a `fencingToken` work, and the token survives the
  kills.

Retry an append with an unknown outcome, dedupe by fact ID, and create every stream with infinite
retention.

## Run it

```bash
bun run --filter ./research/s2-lite-durability check
```

Docker, the versions and the kill loop are in [Setup](results.md#setup).

## Results

[results.md](results.md) holds each run's durability, latency, retention and append-condition
results.

## Untested

A pod kill on k3s, a Garage crash, append sessions, and the owner's volume:
[Untested](results.md#untested).
