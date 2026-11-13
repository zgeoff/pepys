# 0028: mcp-auth.db has no backup

- Date: 2026-11-12
- Status: decided

## Decision

Nothing backs up `mcp-auth.db`, the API's SQLite file of OAuth clients, passkey public keys and
token hashes. The nightly [bucket backup](../design/pepys/runtime.md#processes) copies pepys's
object storage buckets to R2, and `mcp-auth.db` lives on a Kubernetes volume outside them.

## Rejected alternatives

- A copy of `mcp-auth.db` with each bucket backup: R2 would then be one more place that holds the
  client list and the token hashes, and the owner rebuilds both with one enrolment and one sign-in
  per client.

## Why

When a disk fault or a deleted volume loses `mcp-auth.db`, the owner enrols a new passkey and signs
each MCP client in again. Every fact pepys holds is in the fact log, so the loss costs no data.
