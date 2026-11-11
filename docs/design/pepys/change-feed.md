# Change feed

The change feed tells clients which rows changed. Each consumer file holds a change log, written in
the same transaction as the batch it describes, and the API serves each change log over the read
side of the Durable Streams protocol. A dashboard can then hold a live local copy of a table through
TanStack DB, and an agent can tail "waiting on me" over plain HTTP. A replay rebuilds every row
exactly, but not the change log in between: the host debounces scope recomputes by time, so a replay
can merge changes that the live run wrote apart. Every file the host rebuilds, by `pepys up` or by a
restore, therefore starts a new generation of its stream, and no reader ever reads two histories of
one file.

## The change log

The change log is a table in each consumer file with one row per batch: the batch number, which
counts the file's batches from 1, and the batch's changes as State Protocol messages. A message
holds a type, a key, a value, the old value when there is one, and an operation of insert, update or
delete.

The host writes the change log row in the batch's own transaction, so a change exists exactly when
the writes it describes exist. That removes any need for producer IDs, epochs or duplicate checks
between the store and the feed.

The host sends an insert for a key that is new and an update for a key that exists. The State
Protocol leaves an insert on an existing key and an update on a missing key undefined, and clients
of pepys never meet those cases.

## Serving the protocol

The API implements the read side of Durable Streams over the change log: a catch-up read from an
offset, where `-1` means the start and `now` means the tail; long-poll; and server-sent events. Each
response carries the next offset and whether the reader has reached the tail, and a closed stream
tells its readers that it is closed. Clients only read, so the production API serves no stream
creation, append or producer headers.

The Durable Streams repository ships server conformance tests. The API passes their read tests, so
TypeScript clients and TanStack DB work against it. Each read test creates and fills its own stream
with PUT and POST, so the conformance check mounts a write path in its own test app. The production
entry never mounts that write path. The
[conformance spike](https://github.com/zgeoff/pepys/blob/894eb4e7f9bf702d77d797475ab45ddef47b37c4/research/durable-streams-conformance/README.md)
ran the read tests against a minimal server built this way.

Live readers wait on a signal from the host, which it sends over a local socket after each commit.

## Generations

`pepys up` swaps a consumer's whole file, change log included. The generation of a consumer's stream
is a number that the host increments at each swap, a rollback included, and at each restore. A
restore keeps the [consumer version](./host.md#consumer-versions), so the generation cannot be the
version. A newly built file's change log opens with a snapshot: a snapshot-start message, every row
as an insert, and a snapshot-end message. The old generation's stream closes. A reader that sees the
close asks the API for the current generation and reads it from the start; a new reader does the
same. The tables are small, so a full snapshot costs little, and no reader ever needs a diff across
versions.

## Retention

The host trims change log rows older than the latest snapshot. A reader that falls behind the
trimmed range gets the protocol's gone response and restarts from the snapshot.
