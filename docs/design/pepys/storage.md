# Storage

pepys keeps all durable state in one S3-compatible object store, Garage, running on the owner's k3s
server. The log, the lake, consumer modules, store snapshots and attachments each live in their own
bucket. Every other component holds only caches and projections, so recovery needs the buckets and
the binaries. Garage runs as a single node at first and grows to three nodes with three copies of
each object as more machines join the owner's tailnet.

## Garage

Garage is written in Rust and built for small clusters on ordinary hardware, which suits one
person's machines. It runs on k3s from the Helm chart in the Garage repository, as a StatefulSet
with two volumes: a small one on SSD for its metadata database and a large one for the objects.
Metadata on SSD speeds up every read and write.

With one node, Garage keeps one copy of each object, so a failed disk loses the data that is not in
a backup. The owner's existing backups cover the server. Each backup of the facts and blobs buckets
copies objects and never mirrors deletions, so a bug that deletes facts cannot delete the backup
copy on the next run. A second and third node join the cluster as more machines join the tailnet,
and at three nodes Garage keeps three copies and survives the loss of one node.

LUKS encrypts the disk under Garage. One layer of encryption covers the buckets, the git mirrors and
every other cache on the same disk.

## Buckets and keys

| Bucket    | Holds                                               | Writer             | Can it be rebuilt? |
| --------- | --------------------------------------------------- | ------------------ | ------------------ |
| facts     | the log, through s2-lite                            | s2-lite            | no                 |
| blobs     | attachments and raw messages, named by content hash | ingest, enrichment | no                 |
| lake      | Parquet copies of the facts                         | the compaction job | yes, from facts    |
| modules   | compiled consumer modules, named by content hash    | CI                 | yes, from git      |
| snapshots | copies of the store's consumer files                | the host           | yes, by replay     |

Each service has its own access key, scoped to the buckets it uses. A bug in the compaction job can
then damage the lake and nothing else.

Old consumer modules stay in the modules bucket even though git can rebuild them, because every
store row records the hash of the module that wrote it, and a removed module would leave those
hashes pointing at nothing.

## Blobs

A blob is any file a fact refers to: an email attachment, a raw email message, an image in a pull
request. Ingest stores each blob under the SHA-256 hash of its content, so the same file sent three
times is stored once and a read of a blob always returns the same bytes. That property lets
consumers read blobs without breaking replay.

Ingest writes the blob before it appends the fact that references it, so a fact never points at a
missing blob. The fact holds a reference with the hash, the file name, the media type and the size.
Ingest takes every attachment up to a size limit, because a source can delete a file later and Gmail
serves attachments only while the message exists.

Deleted email stays in the blobs bucket, because the design keeps tombstones and never deletes
facts. A real purge, if one is ever needed, removes the blob, since blobs live outside the log.

## Local disks

The host's working copies of the store, the git mirrors that enrichment keeps, and model weights
live on local disk. Each one is a cache: the store rebuilds from snapshots and the log, the mirrors
clone again, and the weights download again.
