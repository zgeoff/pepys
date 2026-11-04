# API

The API is the only way into pepys for tools and agents. It is one Bun process running Elysia v2,
oRPC for typed routes, and an MCP server over streamable HTTP, reachable on the owner's tailnet
only. Every query is a registered object, so one definition gives a typed route, an MCP tool and a
test. The API reads the store and never writes it: every write from a person or an agent becomes a
manual fact in the log.

## Callers

| Caller                               | Wants                    | Through                  |
| ------------------------------------ | ------------------------ | ------------------------ |
| the owner's scripts and CLI          | typed queries            | oRPC                     |
| agents such as Claude Code and Codex | tools with descriptions  | MCP                      |
| a dashboard in the browser           | queries and live updates | oRPC and the change feed |
| automations                          | notice of changes        | the change feed          |

## Registered queries

A query definition holds a name, a description, an input schema and a function that runs the query
with Kysely. From that definition, the API serves an oRPC route with typed input and output, and an
MCP tool whose description is the text the agent reads. A test runs each query against golden facts,
the way consumer tests do.

## The core catalog

The packages ship these queries:

| Query          | Returns                                                    |
| -------------- | ---------------------------------------------------------- |
| get entity     | one entity's full row, its aliases and its shared-view row |
| neighbourhood  | the entities linked to one entity, up to a depth           |
| search         | hybrid full-text and vector results                        |
| entity history | one entity's transitions, each marked exact or observed    |

The neighbourhood walk follows links in both directions through the effective link view. It caps the
depth, skips hub kinds such as people unless the query asks for them, filters by link type on each
hop, and guards against cycles. A hub multiplies the rows of each hop by thousands, so skipping hubs
keeps the walk small. The link type registry types the walk, so a walk along `closes` returns issue
IDs.

The core writes are assert link, retract link and correct label. Each one appends a manual fact.

## The deployment catalog

The deployment adds the queries personal to its owner. The first is "waiting on me": review
requests, assignments and email labelled as needing a reply, with GitHub notification emails folded
into the pull request or issue they notify about. It runs as a deployment consumer in scope mode, so
it has its own change stream, and an agent can subscribe and act when something new needs the owner.

## Auth

The API runs its own OAuth 2.1 server. Each client the owner adds gets its own grant, with the scope
`read` or the scopes `read` and `write`, and every manual fact records the client that wrote it.
[Auth](./auth.md) holds the clients, the flow, the tokens, the scopes per route and the threats.

## Agent writes

An agent may assert a link, with the agent as its origin, a confidence below full, and required
evidence. Queries treat agent links like inferred ones and filter them by confidence. An agent may
correct a label, because the owner classifies mail by working with a model. Every correction counts
as labelled data for the mail label job, and each one names the client that wrote it.

## oRPC and MCP

The API uses oRPC v2, because only v2 has an MCP integration. `@orpc/mcp` turns each query's
procedure into an MCP tool, so the API registers no tool by hand. `@orpc/mcp` needs MCP SDK v2,
which serves the 2026-07-28 MCP revision and falls back to 2025-11-25 for older clients.

oRPC ships no Elysia package. The API mounts oRPC's fetch handler on a wildcard Elysia route with
`parse: 'none'`, so Elysia leaves the request body to oRPC. The
[oRPC spike](../../../research/orpc-elysia-v2/README.md) holds the versions it ran on.
