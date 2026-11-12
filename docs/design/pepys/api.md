# API

The API is the only way into pepys for tools and agents. It is one Bun process running Elysia v2,
oRPC for typed routes, and an MCP server over streamable HTTP. Agents reach MCP on a public route
behind OAuth, tools reach oRPC on the owner's tailnet with a service token
([auth for the API](../api-auth/README.md)), and enrichment reads the change feed and search on a
cluster-internal port ([runtime](./runtime.md#network)). Every query and write is one procedure of
an oRPC contract, so one definition gives a typed route, an MCP tool and a test. The API reads the
store and never writes it: every write from a person or an agent becomes a manual fact in the log.

[pepys v1](../v1.md#the-store-api) builds `get_entity`, `neighbourhood` and each plug-in's queries,
as oRPC routes and MCP tools. It has no search, no entity history, no write, no deployment catalog
and no OAuth: its API checks no token.

## Callers

| Caller                               | Wants                    | Through                  |
| ------------------------------------ | ------------------------ | ------------------------ |
| agents such as Claude Code and Codex | tools with descriptions  | MCP                      |
| a dashboard in the browser           | queries and live updates | oRPC and the change feed |
| automations                          | notice of changes        | the change feed          |

## The contract

`@pepys/contract` holds the oRPC contract: each procedure's catalog key, its description, and the
zod schemas of its input and output. The API implements each procedure with Kysely, through oRPC's
contract-first `implement`, and serves it as an oRPC route with typed input and output and as an MCP
tool whose description is the text the agent reads. A test runs each query against golden facts, the
way consumer tests do.

## The core catalog

The packages ship these queries. Each query's catalog key is snake_case, such as `get_entity`.

| Query          | Returns                                                    |
| -------------- | ---------------------------------------------------------- |
| get entity     | one entity's full row, its aliases and its shared-view row |
| neighbourhood  | the entities linked to one entity, up to a depth           |
| search         | hybrid full-text and vector results                        |
| entity history | one entity's transitions, each marked exact or observed    |

The neighbourhood walk follows links in both directions through the effective link view, which each
query builds as a Kysely common table expression. It caps the depth at 3, skips hub kinds such as
people unless the query asks for them ([entities](./entities.md#people)), filters by link type on
each hop, and guards against cycles. A hub multiplies the rows of each hop by thousands, so skipping
hubs keeps the walk small. The link type registry types the walk, so a walk along `closes` returns
issue IDs.

The core writes are assert link, retract link and correct label. Each one appends a manual fact, and
the fact's payload records the client that wrote it. Before it appends a link, the API checks the
link's two ends against the link type registry, and answers 422 when an end has the wrong kind. An
MCP agent never sees the TypeScript types that would catch the wrong kind.

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

An agent may assert a link, with the agent as its origin. Every manual link, from the owner or an
agent, takes any confidence from 0 to 1 and requires evidence. Queries treat agent links like
inferred ones and filter them by confidence. An agent may correct a label, because the owner
classifies mail by working with a model. Every correction counts as labelled data for the mail label
job, and each one names the client that wrote it.

## oRPC and MCP

The API uses oRPC v2, because only v2 has an MCP integration. `@orpc/mcp` turns each query's
procedure into an MCP tool, so the API registers no tool by hand. `@orpc/mcp` needs MCP SDK v2,
which serves the 2026-07-28 MCP revision and falls back to 2025-11-25 for older clients.

oRPC ships no Elysia package. The API mounts oRPC's fetch handler on a wildcard Elysia route with
`parse: 'none'`, so Elysia leaves the request body to oRPC. The
[oRPC spike](https://github.com/zgeoff/pepys/blob/894eb4e7f9bf702d77d797475ab45ddef47b37c4/research/orpc-elysia-v2/README.md)
holds the versions it ran on.
