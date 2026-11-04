# ORPC on Elysia v2: results

The spike passes on Elysia 2.0.0-rc.0: oRPC 1.16.1 and oRPC 2.0.0-beta.47 each serve a typed route
and an MCP endpoint from one app, and all 44 checks pass in each of 7 runs. The [README](README.md)
holds the question and the answer.

## Method

1. Create a Bun app on the Elysia v2 release candidate.
2. Mount one oRPC route with a zod input through the adapter of oRPC v1, then of oRPC v2.
3. Call the route from the oRPC client and check the typed result.
4. Mount an MCP server beside it on the same app.

The spike passes when one combination of versions serves the typed route and the MCP endpoint from
one Elysia v2 app.

## Setup

The spike ran on Bun 1.4.3 under WSL2, with every server and client in one process over real HTTP on
127.0.0.1. Run it from the repo root:

```bash
bun run --filter ./research/orpc-elysia-v2 check
```

| Package                        | Version       | Role                                  |
| ------------------------------ | ------------- | ------------------------------------- |
| `elysia`                       | 2.0.0-rc.0    | the app                               |
| `@orpc/server`, `@orpc/client` | 2.0.0-beta.47 | oRPC v2                               |
| `@orpc/mcp`                    | 2.0.0-beta.47 | oRPC v2's MCP integration             |
| `orpc-v1-server`               | 1.16.1        | `@orpc/server` v1, under an npm alias |
| `orpc-v1-client`               | 1.16.1        | `@orpc/client` v1, under an npm alias |
| `@modelcontextprotocol/server` | 2.4.0         | MCP SDK v2 server                     |
| `@modelcontextprotocol/client` | 2.4.0         | MCP SDK v2 client                     |
| `@modelcontextprotocol/sdk`    | 1.32.2        | MCP SDK v1, server and client         |
| `zod`                          | 4.6.7         | the input and output schemas          |

Each pin is the newest release at least 7 days old on 2026-11-04, the age `bunfig.toml` enforces.
Elysia 2.0.0-rc.1 turned 7 days old later that day, so the spike stays on rc.0, the version
`packages/api` runs. `@orpc/mcp` 2.0.0-beta.48 and `@orpc/server` 2.0.0-beta.48 were 3 days old.

[run-spike.ts](run-spike.ts) builds two apps. Each serves one query, `get_note`, over an invented
note fixture in [notes.ts](notes.ts):

- [create-v1-app.ts](create-v1-app.ts) serves oRPC v1 at `/rpc/*`. It serves MCP twice, at `/mcp`
  through SDK 1.32.2 and at `/mcp-v2` through SDK 2.4.0, each with the tool registered by hand.
- [create-v2-app.ts](create-v2-app.ts) serves oRPC v2 at `/rpc/*`, and MCP at `/mcp` through
  `@orpc/mcp` and SDK 2.4.0's `createMcpHandler`.

On each app the runner checks the RPC route with a typed call, a bad input, an unknown note, and an
unknown route. On each MCP endpoint it connects three clients: SDK 2.4.0 with version negotiation
`auto`, SDK 2.4.0 with `legacy`, and SDK 1.32.2. Each client lists the tools, calls the tool for a
known note, and calls it for an unknown one. The runner exits non-zero when a check fails.
`bun run typecheck` proves the compile-time parts: the call returns `Note`, a wrong input fails to
compile, and [v2-breaks.ts](v2-breaks.ts) holds each v1 call that v2 refuses.

## The Elysia adapter

oRPC publishes no Elysia package in v1 or v2. Its Elysia docs mount the fetch `RPCHandler` on a
wildcard route with `parse: 'none'`, so Elysia leaves the body for oRPC to read. That mount works on
Elysia 2.0.0-rc.0 with both majors:

| Check               | oRPC 1.16.1   | oRPC 2.0.0-beta.47 |
| ------------------- | ------------- | ------------------ |
| typed call          | the note      | the note           |
| bad input           | `BAD_REQUEST` | `BAD_REQUEST`      |
| unknown note        | `NOT_FOUND`   | `NOT_FOUND`        |
| unknown route       | 404           | 404                |
| result type is Note | compiles      | compiles           |

## MCP

Every MCP endpoint serves every client, with the tool's description, its input and output JSON
Schemas, the note as structured content, and `isError` for an unknown note. The table gives the
protocol revision each client and endpoint negotiate:

| Endpoint                          | SDK 2.4.0 `auto` | SDK 2.4.0 `legacy` | SDK 1.32.2 |
| --------------------------------- | ---------------- | ------------------ | ---------- |
| oRPC v1, SDK 1.32.2, tool by hand | 2025-11-25       | 2025-11-25         | 2025-11-25 |
| oRPC v1, SDK 2.4.0, tool by hand  | 2026-07-28       | 2025-11-25         | 2025-11-25 |
| oRPC v2, SDK 2.4.0, `@orpc/mcp`   | 2026-07-28       | 2025-11-25         | 2025-11-25 |

SDK 2.4.0's client defaults to `legacy`, so a client reaches the 2026-07-28 revision only when it
asks for `auto`. `createMcpHandler` serves each request from a fresh server, with no session.

`@orpc/mcp` exists only as 2.0.0 betas and peer-depends on `@modelcontextprotocol/server` 2 or
later. Handed a v1 router, it fails to type-check and throws at `register`:
`[Contract-First] Missing or invalid implementation for procedure at path: "get_note"`. With oRPC
v1, the hand-written tool takes about 25 lines: it calls the procedure through oRPC's `call` and
turns an `ORPCError` into an `isError` result.

SDK 1.32.2 has 17 direct dependencies, Express and Hono among them. `@modelcontextprotocol/server`
2.4.0 has 2: `@modelcontextprotocol/core` and zod.

## Breaks from oRPC v1 to v2

`packages/api` makes two calls that oRPC 2.0.0-beta.47 refuses, and [v2-breaks.ts](v2-breaks.ts)
fails the type check if either starts to compile:

- The builder has no `.route()`. A procedure's summary and description move to `.meta()`, through
  `mcp.tool()` or the OpenAPI meta.
- `RPCLink`'s `url` takes a path. The scheme and host go in a separate `origin` option.

`RPCHandler.handle` still returns `{ matched, response }`, and `Schema`, `os`, `ORPCError` and
`call` are still exported. oRPC v2 drops the `./bun-ws`, `./ws` and `./hibernation` exports of
`@orpc/server`, which `packages/api` does not import.

## Untested

- Elysia 2.0.0-rc.1, and oRPC and `@orpc/mcp` 2.0.0-beta.48.
- Auth: better-auth's OAuth provider and MCP plugins in front of `/mcp`.
- Origin and Host header checks, which `createMcpHandler` leaves to the caller.
- Streamed results, progress notifications and the change feed over either protocol.
- Real agent clients, such as Claude Code and Codex, and which protocol revision each asks for.
- The API's own queries, their Kysely reads, and `packages/api` itself on oRPC v2.
- Load, latency and memory.
