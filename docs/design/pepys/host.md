# Host

The built host runs one task per consumer, deploys versions with `up`, and applies fact-mode and
scope-mode batches, as [the host](../../architecture/consumers/host.md) describes. This design adds
a scheduler for scope consumers, versions that name the enrichment champions they read, more reads
for a consumer, snapshots of the store, and a signal that wakes the API after each commit.

## Scheduling

A scope runs on one worker at a time: the host takes a keyed lock per scope, so two recomputes of
one pull request never overlap and miss each other's facts. Different scopes run in parallel, up to
a concurrency limit per consumer of 4 by default.

The host keeps the set of dirty scopes in memory and debounces it for 500 ms by default, so a burst
of pushes to one pull request causes one recompute. The host's config sets both the concurrency
limit and the debounce window. Each scope consumer keeps an offset into the change feed it listens
to, and on restart the host rebuilds the dirty set from that offset. A scope consumer listens to
entity changes and never to link changes, because its own link writes would otherwise trigger it
again.

## Reads

A consumer reads two more things from the host, beside a row by key and a scope's facts:

- a scan of a table by an index and a key prefix;
- a blob by its content hash, which is pure because a hash always names the same bytes.

A fact-mode consumer gets no read of an entity's earlier facts. It keeps what it needs in its own
rows, and a consumer that needs every fact of an entity runs in scope mode.

## Consumer versions

A consumer version is a module plus the champion version of each enrichment job the module reads.
The host names a version by one hash of the module's content and those champions, so a job promotion
gives each reader a new version. Every row the host writes records the hash of the version that
wrote it.

## Preview and up

`pepys up` marks dirty every dependent scope whose input rows the diff changed, once the swap is
done, so a scope consumer that reads another consumer's rows recomputes what the new version
changed. When a swap is done, the host sends a `consumer.swapped` event over the commit socket
([waking readers](#waking-readers)), so the API attaches the new file.

## Snapshots

After a checkpoint, the host copies each current file to the snapshots bucket on a schedule. A
restore downloads the snapshots and replays only the facts after each snapshot's offsets. A restored
file starts a new generation of its change stream, as `pepys up` does
([change feed](./change-feed.md#generations)), because its replayed change log differs from the one
readers already read.

## Waking readers

After each commit, the host signals the API over a local socket, the commit socket, so live
change-stream readers get new rows without polling the files.
