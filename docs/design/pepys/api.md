# API

The built API serves `get_entity`, `neighbourhood` and each plug-in's queries as oRPC routes and MCP
tools, reads the store, checks no token on `/rpc`, and checks an access token on `/mcp`, as
[the API](../../architecture/queries/api.md) describes. This design adds the core writes, the search
and history queries, the deployment catalog, and the callers that reach the API with a credential.
The API still never writes the store: every write from a person or an agent becomes a manual fact in
the log, and the host applies it.

## Callers

The API's callers reach it three ways:

- agents reach MCP on a public route, with an OAuth token;
- the owner's scripts reach oRPC on the owner's tailnet, and pods reach oRPC and MCP inside the
  cluster, each with a service token;
- enrichment reads the change feed and search on an internal port ([runtime](./runtime.md#network)).

[Auth for the API](../api-auth/README.md) owns which listener serves each route, and which
credential each listener takes.

| Caller                               | Wants                   | Through         |
| ------------------------------------ | ----------------------- | --------------- |
| agents such as Claude Code and Codex | tools with descriptions | MCP             |
| automations                          | notice of changes       | the change feed |

## The core catalog

| Query          | Returns                                                    |
| -------------- | ---------------------------------------------------------- |
| get entity     | one entity's full row, its aliases and its shared-view row |
| search         | hybrid full-text and vector results                        |
| entity history | one entity's transitions, each marked exact or observed    |

The link type registry types the neighbourhood walk, so a walk along `closes` returns issue IDs, and
the walk's `link_effective` view leaves out every retracted link ([links](./links.md#link-tables)).

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
[Auth](./auth.md) holds the OAuth clients, the flow, the OAuth tokens, the scopes and the threats.

## Agent writes

An agent may assert a link, with the agent as its origin. Every manual link, from the owner or an
agent, takes any confidence from 0 to 1 and requires evidence. Queries treat agent links like
inferred ones and filter them by confidence. An agent may correct a label, because the owner
classifies mail by working with a model. Every correction counts as labelled data for the mail label
job, and each one names the client that wrote it.
