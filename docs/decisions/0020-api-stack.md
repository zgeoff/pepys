# 0020: One API process on Elysia v2, oRPC and MCP

Date: 2026-10-22

## Decision

The API is one Bun process running Elysia v2, oRPC for typed routes, and an MCP server over
streamable HTTP, reachable on the owner's tailnet only. Auth follows the OAuth connector pattern
from the owner's agent control tower, on better-auth.

## Rejected alternatives

| Option                   | Why not                                                                   |
| ------------------------ | ------------------------------------------------------------------------- |
| hand-written REST routes | the owner's stack requires a typed API layer                              |
| Elysia v1                | the owner adopts new major versions early, and v2 is at release candidate |

## Why

One query definition gives a route, an MCP tool and a test, so the owner's scripts and agents see
the same catalog. The oRPC spike decides whether Elysia v2 needs oRPC v2.
