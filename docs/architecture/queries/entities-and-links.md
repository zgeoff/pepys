# Entities and links

An entity is one thing from one source, such as a pull request, a release or a model request, and a
link joins two entities, usually from different sources. Every entity has a global string ID that
carries its kind, so a query or a link can name an entity before its row exists. Each consumer owns
full tables for its kinds, and declares one entity view per table whose rows are entities. The API
unions those views across every consumer file into one `entity` view with six columns, and unions
the consumers' link tables into one `link_effective` view, so one query reads every source.

[Plug-ins and the build](../consumers/plug-ins-and-build.md) covers how a consumer declares its
tables, entity views and link types. [The host](../consumers/host.md#the-link-check) covers the
check of each link a consumer writes. [The API](./api.md) covers the queries that read the two
views. [Decision 0011](../../decisions/0011-per-source-entity-tables.md) and
[decision 0012](../../decisions/0012-stable-ids-and-aliases.md) record why tables are per source and
IDs come from source database IDs.

## Entity IDs

An entity ID has the form `<source>:<kind>:<id>`, and its first two parts are its entity kind, such
as `github:pull_request:1874433021`. The last part is the source's database ID when the source gives
one, because a database ID survives a repository rename or a login change, and a readable form such
as `acme/api#412` does not. No foreign key joins two entities, so a link to a pull request exists
before the pull request arrives, and a join fills in when it lands.

A kind with no database ID builds its last part from other fields:

| Kind                                             | Last part                                                                   |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| `github:ref`                                     | `<repository ID>:<ref>`, such as `902:refs/heads/main`                      |
| `github:deploy`                                  | `<repository ID>:<environment>:<signal>:<sha>`, then `:<target>` when named |
| `telemetry:session`                              | the session ID that the log record carries                                  |
| `telemetry:model_request`, `telemetry:turn_cost` | the ID of the fact it comes from, with `event:telemetry:` cut               |

A kind is lowercase with `_` between words. A kind may have no table: `telemetry:session` is one, so
a link can point at a session, and `get_entity` finds none.

## The entity view

Each consumer's file has an `entity` view that selects six columns from its declared tables: ID,
kind, title, URL, actor and update time. The view copies no data, so a full table and the shared
view cannot disagree. A consumer's own file holds only its own view. The API builds the shared view
for each query as a common table expression, a `union all` over the `entity` view of every file the
query attached, because Turso refuses a temporary view over attached files. The same holds for
`link_effective`.

The common table expressions reach only queries that Kysely builds. A query written as raw SQL gets
neither view, and a bare `entity` there reads the view of the first attached file alone.

The kinds with an entity view in this repo's plug-ins are `github:pull_request`, `github:release`,
`github:deploy`, `telemetry:model_request` and `telemetry:turn_cost`. A GitHub release that GitHub
deleted keeps its row, with the time of the delete in `deleted_at`, and every reader of that table
filters on it. The entity view has no deleted-at filter, so `get_entity` and `neighbourhood` still
return a deleted release.

## Links

A consumer declares each link type it writes, with the kind or kinds of each end. A link is flat: a
type, two entity IDs, a confidence from 0 to 1, and a fact ID as its evidence. The host checks each
link against the consumer's declared types before it writes it, and writes it to the `link` table of
the consumer's own file. That table is in every consumer file, so an unlink from a consumer with no
link types deletes nothing.

| Column       | Holds                                              |
| ------------ | -------------------------------------------------- |
| `type`       | the link type                                      |
| `from_id`    | the entity ID of one end                           |
| `to_id`      | the entity ID of the other end                     |
| `scope`      | the scope that owns the link, or null in fact mode |
| `origin`     | the name of the consumer that wrote it             |
| `confidence` | from 0 to 1                                        |
| `evidence`   | the ID of the fact the link rests on               |

One file holds one consumer, so the key is `(type, from_id, to_id)`. The test store's one database
adds `origin` to the key.

The API's `link_effective` unions the `link` tables of the consumers that declare a link type, and
drops nothing. A link type may carry the hub flag, for a type that joins one entity to a great many,
and the neighbourhood walk follows a hub type only when the caller asks.

No GitHub or telemetry consumer in this repo writes a link, so links come from plug-ins outside it.
A pull request's tie to its release and deploy is made by a query when it runs, as
[the GitHub plug-in](../plug-ins/github.md#the-delivery-query) describes.

## Known limits

- Neither a repository nor a user has a table, so `get_entity` finds neither, though both appear in
  column values.
- `neighbourhood` shows no release and no deploy, because no consumer writes a link to one, and it
  never resolves a session.
