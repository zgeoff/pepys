# 0020: One API process on Elysia v2, oRPC and MCP

Date: 2026-10-22

Updated: 2026-11-12

## Decision

The API is one Bun process running Elysia v2, oRPC v2 for typed routes, and an MCP server over the
MCP spec's streamable HTTP transport. MCP and sign-in are public, and the oRPC routes stay on the
owner's Tailscale network, the tailnet, as [0027](./0027-rpc-stays-off-the-public-route.md) sets
out. [0025](./0025-own-oauth-server-with-passkey.md) and
[0026](./0026-credentials-bound-to-listeners.md) set how the API checks its callers.

## Rejected alternatives

| Option                      | Why not                                                              |
| --------------------------- | -------------------------------------------------------------------- |
| hand-written REST routes    | the owner wants a typed API layer in every project                   |
| Elysia v1                   | the owner adopts new major versions early                            |
| the API on the tailnet only | the owner's agents reach MCP from devices and places off the tailnet |

## Why

Each query is one oRPC procedure, and the API serves it as a typed route and as an MCP tool, and
tests it once. The owner's scripts and agents then see the same set of queries. Only oRPC v2 has an
MCP integration, so the API runs oRPC v2
([oRPC and MCP](../architecture/queries/api.md#the-router)).

## Changes

- 2026-11-12: MCP and sign-in became public, and the API's auth rules moved to records 0025 to 0027.
