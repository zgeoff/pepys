# Spike: s2-lite durability

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
