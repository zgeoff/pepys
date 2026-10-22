# 0006: Consumers return operations, and the host applies them

Date: 2026-10-22

## Decision

A consumer reads through typed host calls and returns its writes as a list of upsert and delete
operations. The host applies the list, after checking every operation against the tables the
consumer owns.

## Rejected alternatives

| Option                | Why not                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------- |
| host calls for writes | tests and version diffs would have to capture write calls instead of comparing returned lists |
| SQL strings for reads | Kysely under scriptc is unknown, and SQL widens the module boundary                           |

## Why

Returned operations keep consumers pure and make three things free: ownership is a check on a list,
a diff between two versions is a comparison of two lists, and a test passes in facts and asserts the
list.
