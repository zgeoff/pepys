# Entities and links

A query in pepys reads the entities and links of every source through two shared names, `entity` and
`link_effective`, whatever consumer wrote the rows. The host keeps each consumer, the code in a
plug-in that turns facts into rows, in a database file of its own, as
[the host](../consumers/host.md#commands-and-the-store-folder) describes. Pull requests, releases
and model requests are entities: each one is one thing from one source. A link joins two entities by
their IDs, with a type, a confidence and the fact it rests on.

[Plug-ins and the build](../consumers/plug-ins-and-build.md) covers how a consumer declares its
tables, entity views and link types. [The host](../consumers/host.md#the-link-check) covers the
check of each link a consumer writes. [The API](./api.md#the-core-queries) covers `get_entity`,
which returns one entity, and `neighbourhood`, which walks the links around one.
[Decision 0011](../../decisions/0011-per-source-entity-tables.md) and
[decision 0012](../../decisions/0012-stable-ids-and-aliases.md) record why tables are per source and
IDs come from source database IDs.

## Entity IDs

An entity ID has the form `<source>:<kind>:<id>`, such as `github:pull_request:1874433021`. Its
first two parts, such as `github:pull_request`, are its entity kind, which is lowercase with `_`
between words. The last part is the source's database ID when the source gives one. A database ID
survives a repository rename or a login change, and a readable form such as `acme/api#412` does not.

A kind with no database ID builds its last part from other fields:

| Kind                                             | Last part                                                                                               | Example                                                    |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `github:ref`                                     | `<repository ID>:<ref>`                                                                                 | `github:ref:902:refs/heads/main`                           |
| `github:deploy`                                  | `<repository ID>:<environment>:<signal>:<sha>`, with `:<target>` added when the deploy tag has a target | `github:deploy:902:production:tag:4f1c2a9e`                |
| `telemetry:session`                              | the record's `atc.session.id` attribute, or the agent's own session ID                                  | `telemetry:session:5b0e7d1c`                               |
| `telemetry:model_request`, `telemetry:turn_cost` | the ID of the fact the row comes from, with its `event:telemetry:` prefix removed                       | `telemetry:model_request:claude_code.api_request:req_8812` |

In the `github:deploy` row, `<signal>` is how GitHub reported the deploy: `tag` for a push that
moved a deploy tag, and `deployment_status` for a deployment status of `success`.
[Deploys](../plug-ins/github.md#deploys) covers the deploy tag and its target.
[One record becomes one fact](../plug-ins/telemetry.md#one-record-becomes-one-fact) covers how the
telemetry plug-in picks a record's session.

A link stores only the two IDs, and the store holds no foreign key between entities. A consumer can
therefore write a link to a pull request before the pull request's row exists. A query that joins
the link to `entity` returns the row once the pull request's consumer writes it.

Some kinds have IDs and no table: `github:repo`, `github:user` and `telemetry:session`. Their IDs
appear in column values, such as a pull request's `repository_id`, and as the entity of a fact, but
`get_entity` returns not found for each.

## The entity view

Each consumer declares one entity view per table whose rows are entities. `pepys build` writes those
declarations into the consumer's SQL schema as one view named `entity`, a `union all` with six
columns: `id`, `kind`, `title`, `url`, `actor` and `updated_at`. `actor` is the entity ID of whoever
made the entity, or null. In this repo, only the pull request view sets it, to the author's
`github:user` ID. The view copies no data, so a consumer's tables and its `entity` view always
agree.

The kinds with an entity view in this repo's plug-ins are:

- `github:pull_request`;
- `github:release`;
- `github:deploy`;
- `telemetry:model_request`;
- `telemetry:turn_cost`.

The shared `entity` and `link_effective` exist only inside a query. Turso, the SQLite engine of the
store, refuses a temporary view over attached database files, so the API's store reader
([one call](./api.md#one-call)) builds them on each query instead. It attaches the files of the
consumers the query needs, and puts two common table expressions in front of the query:

- `entity`: a `union all` of the `entity` view of each attached file that has one;
- `link_effective`: a `union all` of the `link` table of each attached consumer that declares a link
  type.

The store reader adds the two only to a query built with Kysely, the API's query builder. A query in
raw SQL gets neither, and a bare `entity` there reads the `entity` view of one attached file alone.

A consumer keeps the row of a deleted entity when a late fact could otherwise bring it back, and
marks the delete in a nullable timestamp column. An entity view names that column as its
`deletedAt`, and `pepys build` then writes `WHERE <column> IS NULL` into the view, so a deleted
entity is in no `entity` view:

- `get_entity` returns not found for it;
- `neighbourhood` leaves it out of `entities`, and lists its ID in `unresolved` when a link or the
  start of the walk reaches it.

The deployment check refuses a `deletedAt` that names no nullable timestamp column of the view's
table. In this repo, only the release view sets it, to `deleted_at`: a GitHub release that GitHub
deleted keeps its row, and the GitHub plug-in's own queries skip it too.

## Links

A consumer declares each link type it writes, with the kind or kinds allowed at each end. The host
checks each link against those types, then writes it to the `link` table in the consumer's own file.
Each row holds:

- `type`, and the entity IDs of the two ends, `from_id` and `to_id`;
- `confidence`, from 0 to 1;
- `evidence`, the ID of the fact the link rests on;
- `scope`, the entity ID of the scope whose recompute wrote the link, for a consumer in
  [scope mode](../consumers/host.md#a-scope-mode-batch), or null for a consumer that applies one
  fact at a time;
- `origin`, the name of the consumer.

The primary key is `(type, from_id, to_id)`, because one file holds one consumer and `origin` is the
same in every row. The [test store](../consumers/plug-ins-and-build.md#the-test-store) holds every
consumer in one database, so its key adds `origin`.

The host creates a `link` table in every consumer file, even for a consumer that declares no link
type. A consumer that returns an unlink operation with no link stored for its ends changes no row,
and the host fails on no missing table.

`link_effective` keeps every row of every file, so two consumers that write the same link give two
rows. `neighbourhood` counts such a link once, with the higher confidence. A link type can carry the
hub flag, for a type that joins one entity to many others, and `neighbourhood` follows a hub type
only when the caller asks.

The GitHub and telemetry consumers in this repo write no link, so every link in a deployment comes
from a plug-in outside the repo. The GitHub plug-in ties a pull request to its release and deploy in
a query, when the query runs, as [the delivery query](../plug-ins/github.md#the-delivery-query)
describes.

## Known limits

- `get_entity` returns not found for a repository, a user or a session, because each kind has no
  table.
- `neighbourhood` reaches a release or a deploy only when a consumer outside this repo writes a link
  to one. It puts a session ID in its `unresolved` list, because a session has no row.
