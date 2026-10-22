# 0001: Object storage holds all durable state

Date: 2026-10-22

## Decision

Every durable byte of pepys lives in one S3-compatible store, Garage, on the owner's k3s server. The
log, blobs, the lake, consumer modules and store snapshots each get a bucket. Every other component
holds only caches and projections that rebuild from the buckets.

## Rejected alternatives

| Option                            | Why not                                                     |
| --------------------------------- | ----------------------------------------------------------- |
| a folder on one disk              | a failed disk loses everything, with no path to more copies |
| SeaweedFS                         | a larger system than one person's machines need             |
| an object store written for pepys | Garage exists and runs on k3s                               |
| a hosted object store             | the owner keeps pepys on infrastructure they run            |

## Why

One durable place makes recovery one step: restore the buckets, start the binaries, replay. Garage
is written in Rust, built for small clusters on ordinary hardware, and grows from one node to three
without a migration.
