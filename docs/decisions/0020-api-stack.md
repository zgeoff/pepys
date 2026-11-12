# 0020: One API process on Elysia v2, oRPC and MCP

Date: 2026-10-22

Updated: 2026-11-12

## Decision

The API is one Bun process running Elysia v2, oRPC for typed routes, and an MCP server over
streamable HTTP. [0027](./0027-rpc-stays-off-the-public-route.md) sets which routes are public, and
[0025](./0025-own-oauth-server-with-passkey.md) and [0026](./0026-credentials-bound-to-listeners.md)
set how the API checks its callers.

## Rejected alternatives

| Option                      | Why not                                                                   |
| --------------------------- | ------------------------------------------------------------------------- |
| hand-written REST routes    | the owner's stack requires a typed API layer                              |
| Elysia v1                   | the owner adopts new major versions early, and v2 is at release candidate |
| the API on the tailnet only | the owner's MCP clients reach pepys from devices off the tailnet          |

## Why

One query definition gives a route, an MCP tool and a test, so the owner's scripts and agents see
the same catalog. The oRPC spike decides whether Elysia v2 needs oRPC v2.

## Changes

- 2026-11-12: the API is no longer reachable on the tailnet only. MCP and sign-in go public, and the
  auth rules moved to their own records.
