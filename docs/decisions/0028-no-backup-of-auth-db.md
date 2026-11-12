# 0028: auth.db has no backup

Date: 2026-11-12

## Decision

The bucket backup never copies `auth.db`, the API's SQLite file of clients, passkeys and token
hashes. `auth.db` lives on a volume with the `Retain` reclaim policy, and nothing else holds a copy.

## Rejected alternatives

| Option                               | Why not                                                                                                                    |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| a copy of `auth.db` with each backup | a copy outside the API's volume is one more place that holds the owner's client list, passkey public keys and token hashes |

## Why

A lost `auth.db` costs one passkey enrolment and one sign-in per client. Every fact stays in the
log, so no data is lost with it.
