# 0017: The change feed lives in the store and speaks Durable Streams

Date: 2026-10-22

## Decision

Each consumer file holds a change log, written in the same transaction as the batch it describes.
The API serves it over the read side of the Durable Streams protocol, with State Protocol messages,
and checks itself with the protocol's conformance tests. A consumer swap starts a new stream
generation that opens with a snapshot.

## Rejected alternatives

| Option                          | Why not                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------- |
| the Durable Streams Rust server | a standalone binary rather than a library, and a second log with its own write-ahead log and disk |
| change streams in s2-lite       | splits each write between the store and the log                                                   |
| s2-lite serving the protocol    | s2-lite implements the S2 API only                                                                |

## Why

Writing the change log with the batch makes the feed exact by construction, with no producer IDs,
epochs or duplicate checks. The protocol is the valuable part, because TanStack DB and the client
libraries speak it, and serving its read side costs a few hundred lines.
