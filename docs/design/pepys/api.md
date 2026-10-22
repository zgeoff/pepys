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

The API uses the OAuth connector pattern from the owner's agent control tower, built on better-auth
with its OAuth provider and MCP plugins. Two scopes exist: read, and read plus manual writes. Each
client gets its own grant, and every manual fact records the client that wrote it.

## Agent writes

An agent may assert a link, with the agent as its origin, a confidence below full, and required
evidence. Queries treat agent links like inferred ones and filter them by confidence. An agent may
not correct a label, because only the owner's corrections count as the test set for model jobs.

## Open questions

The [oRPC spike](./spikes/orpc-elysia-v2/README.md) checks whether oRPC's Elysia adapter supports
Elysia v2, and which oRPC major version it needs.
