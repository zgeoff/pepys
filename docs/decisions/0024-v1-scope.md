# 0024: The scope of v1

Date: 2026-11-11

## Decision

The first version of pepys stores the facts of [boxxy](https://github.com/zgeoff/boxxy) and of
GitHub, builds entities and links from them, and answers queries about them over oRPC and MCP. boxxy
dispatches work to coding agents and measures what the work costs. The
[design](../design/pepys/README.md) describes the whole of pepys and defines its terms, such as
source, consumer and deployment. This record lists the parts of that design that are in v1.

- The core of the [pipeline](../design/pepys/README.md#pipeline) is in v1, and works for any source.
  [Ingest](../design/pepys/ingest.md) has an interface that each source fills in. The
  [host](../design/pepys/host.md) runs every consumer that the deployment declares, in both
  [input modes](../design/pepys/consumers.md#input-modes). The `pepys`
  [CLI](../design/pepys/runtime.md#the-cli) has one command, `pepys up`, which deploys a consumer.
- Three sources are in v1. The GitHub source brings pull requests, issues, reviews, merges and
  releases. A telemetry source receives the OpenTelemetry log records that Claude Code sends, and
  its consumer keeps one row for each model request, with the request's cost. boxxy is the third
  source: boxxy sends an HTTP request with a signed batch of its facts to an ingest URL, as GitHub
  sends a webhook. Each fact records one change to boxxy's work, such as an attempt that started.
- The boxxy source, its consumer and its query live in one package in the boxxy repo. The deployment
  registers that package's consumer and query in
  [the deployment catalog](../design/pepys/api.md#the-deployment-catalog). The
  [core packages](../design/pepys/README.md#packages) import nothing from boxxy and hold no boxxy
  name.
- pepys publishes what a source outside this repo builds against. Its packages go to npm, with the
  types of a source, a consumer and a query. The CLI gets a command that compiles a consumer. Each
  release carries the host binary. pepys publishes no container image: the repo that holds a
  deployment builds its own images.
- [Links](../design/pepys/links.md) are in v1 in part. v1 has the registry of link types, the link
  tables, the host's check that a link joins the entity kinds its type allows, and the
  [structural links](../design/pepys/links.md#structural-links) that a consumer writes for its own
  entities. The boxxy consumer writes two more: a link from each attempt to the agent sessions that
  ran the attempt, and a link from each attempt to the pull requests that the attempt produced. v1
  has none of the [link extractors](../design/pepys/links.md#link-extractors), which find links in
  text, mail headers and blame results.
- The API runs on oRPC v2 and serves each query as a typed route and as an MCP tool
  ([oRPC and MCP](../design/pepys/api.md#orpc-and-mcp)).
  [The core catalog](../design/pepys/api.md#the-core-catalog) in v1 holds two queries: get entity,
  and neighbourhood, which walks the links around one entity. The API takes no write in v1.
- The v1 API checks no token. The owner's private network and the cluster's network policies decide
  who reaches the API. The [auth design](../design/pepys/auth.md) is not in v1, and no source of
  personal data, such as mail, joins a deployment before auth is built.
- The v1 deployment runs five of the seven [processes](../design/pepys/runtime.md#processes):
  Garage, s2-lite, ingest, the host with the API, and the bucket backup. Enrichment and compaction
  are not in v1.
- These parts of the design are not in v1: the Gmail source,
  [enrichment](../design/pepys/enrichment.md), [search](../design/pepys/search.md), the link
  extractors, [manual links](../design/pepys/links.md#manual-and-agent-links),
  [entity history](../design/pepys/history.md),
  [champion and challenger](../design/pepys/architecture.md),
  [the lake](../design/pepys/history.md#the-lake), snapshots and restore, and the
  [change feed](../design/pepys/change-feed.md).

## Rejected alternatives

| Option                                                                 | Why not                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| an API route that appends boxxy's facts to boxxy's own part of the log | the route puts the name of one source in a core package, and boxxy's writes then depend on API auth; a source that fills in the ingest interface needs neither                                                                             |
| the boxxy consumer and query in this repo                              | a change to a boxxy fact then needs a change in two repos, and the types of the fact's payload exist twice                                                                                                                                 |
| a container image from this repo                                       | the repo that holds the deployment adds its own consumers and entry files, so it builds an image in any case, and a base image from here adds a second thing to release and to patch                                                       |
| v1 with no links                                                       | without links, one query can still join boxxy's tables to the telemetry table, but that join stays private to the query: a second query or an MCP tool can't follow it from a pull request to the attempts and the spend behind it         |
| the "waiting on me" query as part of pepys                             | the query lists what waits on the owner across every source, and it belongs to a deployment, which builds it on top of pepys; it needs the link extractors and the owner's identity, which v1 leaves out                                   |
| the Gmail source in v1                                                 | boxxy's facts, GitHub and telemetry answer every question that v1 is built for, and mail adds nothing to them                                                                                                                              |
| the auth design in v1                                                  | each agent that boxxy starts runs on a fresh machine with no token, so each one needs a sign-in by the owner or a token broker that does not exist; v1 holds GitHub data, boxxy's facts and telemetry, which those agents can already read |
| the change feed in v1                                                  | each v1 reader asks a query when it wants an answer, and has no use for a live stream of changes                                                                                                                                           |

## Why

Two readers set the size of v1. boxxy stores every fact in pepys and reads back what each piece of
work cost, so v1 takes boxxy's facts and telemetry in, and serves a cost query out. Agents ask about
a pull request and the work behind it through MCP, so v1 has GitHub entities, links and the
neighbourhood query. Each part of the design that v1 leaves out builds on the same core.

boxxy is the first source that this repo does not own. Building boxxy as a source proves that the
ingest interface is enough for an outside source, and upholds the rule that a core package never
imports a source package ([packages](../design/pepys/README.md#packages)).
