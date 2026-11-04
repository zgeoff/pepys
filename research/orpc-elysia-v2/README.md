# Spike: ORPC on Elysia v2

The API runs Elysia v2 with oRPC for typed routes and an MCP server for agents. Elysia v2 is at
release candidate and oRPC v2 is in beta, so this spike mounts oRPC v1 and v2 on one Elysia v2 app
with an MCP endpoint beside the routes, for the API design.

## Question

Does oRPC's Elysia adapter work with Elysia v2, does it need oRPC v1 or v2, and can the same app
serve an MCP server over streamable HTTP?

## Answer

- The spike passes: on Elysia 2.0.0-rc.0, oRPC 1.16.1 and 2.0.0-beta.47 each serve the typed route
  and an MCP endpoint from one app, and all 44 checks pass.
- oRPC ships no Elysia package. Its Elysia adapter is the fetch handler on a wildcard route with
  `parse: 'none'`, the mount `packages/api` uses.
- Only oRPC v2 has an MCP integration: `@orpc/mcp` turns each procedure into a tool. It needs MCP
  SDK v2 and refuses a v1 router.
- MCP SDK v2 (`@modelcontextprotocol/server` 2.4.0) serves the 2026-07-28 revision and falls back to
  2025-11-25 for older clients. SDK 1.32.2 stops at 2025-11-25 and never serves 2026-07-28.
- Moving `packages/api` to oRPC v2 breaks three calls it makes: the builder's `.route()`, a full URL
  in `RPCLink`'s `url`, and a custom `fetch` that takes a `Request`.

Keep oRPC 1.16.1 and serve MCP through `@modelcontextprotocol/server` with tools registered by hand
from the query definitions, then switch to `@orpc/mcp` once oRPC v2 leaves beta.

## Run it

```bash
bun run --filter ./research/orpc-elysia-v2 check
```

The versions and the checks are in [Setup](results.md#setup).

## Results

[results.md](results.md) holds the RPC, MCP and break results.

## Untested

Elysia 2.0.0-rc.1, auth, Origin and Host checks, streaming and real agent clients:
[Untested](results.md#untested).
