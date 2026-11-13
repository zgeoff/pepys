# Entities and links

Pull requests, releases and model requests are entities: each one is one thing from one source. A
link joins two entities by their IDs, with a type, a confidence and the fact it rests on. A
consumer, the code in a plug-in that turns facts into rows, writes both. The host keeps each
consumer's rows in a database file of its own, as
[the host](../consumers/host.md#commands-and-the-store-folder) describes.

A query in pepys reads the entities and links of every source through two shared views, `entity` and
`link_effective`, whatever consumer wrote the rows. The API builds the two shared views for each
query, from the files of the consumers that the query reads.

- [Plug-ins and the build](../consumers/plug-ins-and-build.md) covers how a consumer declares its
  tables, entity views and link types.
- [The host](../consumers/host.md#the-link-check) covers the check of each link a consumer writes.
- [The API](./api.md#the-core-queries) covers `get_entity`, which returns one entity, and
  `neighbourhood`, which walks the links around one and returns the IDs it could not find in its
  `unresolved` list.
- [The fact envelope](../ingest/fact-log.md#the-fact-envelope) covers a fact's ID and the entity it
  names.
- [Decision 0011](../../decisions/0011-per-source-entity-tables.md) and
  [decision 0012](../../decisions/0012-stable-ids-and-aliases.md) record why tables are per source
  and IDs come from source database IDs.

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
| `github:review_thread`                           | the database ID of the thread's first comment, which each reply's `in_reply_to_id` gives                | `github:review_thread:5101`                                |
| `telemetry:session`                              | the session ID of an agent session, as the telemetry plug-in reads it from a log record                 | `telemetry:session:5b0e7d1c`                               |
| `telemetry:model_request`, `telemetry:turn_cost` | the ID of the fact the row comes from, with its `event:telemetry:` prefix removed                       | `telemetry:model_request:claude_code.api_request:req_8812` |

In the `github:deploy` row, `<signal>` is how GitHub reported the deploy: `tag` for a push that
moved a deploy tag, and `deployment_status` for a deployment status of `success`.
[Deploys](../plug-ins/github.md#deploys) covers the deploy tag and its target.

The telemetry plug-in stores each OpenTelemetry log record as one fact, with an ID of the form
`event:telemetry:<product>.<event>:<key>`.
[One record becomes one fact](../plug-ins/telemetry.md#one-record-becomes-one-fact) covers how the
plug-in picks a record's session and its key.

A link stores only the two IDs, and the store holds no foreign key between entities. A consumer can
therefore write a link to a pull request before the pull request's row exists. A query that joins
the link to `entity` returns the row once the pull request's consumer writes it.

Some kinds have IDs and no entity view, because no consumer keeps a row for them: `github:repo`,
`github:user`, `telemetry:session`, and the kinds of the GitHub families that
[no consumer builds](../plug-ins/github.md#families-and-consumers), such as `github:issue_comment`.
Their IDs appear in column values, such as a pull request's `repository_id`, and in the `entity`
field of a fact. `get_entity` returns not found for each, and `neighbourhood` lists each one it
reaches in `unresolved`.

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

The API's store reader opens one connection for a call and attaches each consumer file the call
reads, as [One call](./api.md#one-call) describes. A view across all the attached files would have
to be a temporary view, and Turso, the SQLite engine of the store, refuses a temporary view over
attached files. The store reader therefore puts two common table expressions in front of each query,
and these are the shared views:

- `entity`: a `union all` of the `entity` view of each attached file that has one;
- `link_effective`: a `union all` of the `link` table of each attached consumer that declares a link
  type.

The shared `entity` has the same name as each file's own `entity` view. Inside the query, SQLite
resolves the bare name `entity` to the common table expression. The store reader adds the two shared
views only to a query built with Kysely, the API's query builder. In a query in raw SQL, SQLite
resolves a bare `entity` to the `entity` view of the first attached file alone.

A consumer can keep the row of a deleted entity. Take a release that GitHub deletes: the consumer
stores the delete, and a fact from before the delete can still arrive later. A kept row lets the
consumer see the delete and refuse to bring the release back. The consumer marks the delete in a
nullable timestamp column, and the entity view declares that column as its `deletedAt`.
`pepys build` then writes `WHERE <column> IS NULL` into the view, so a deleted entity is in no
`entity` view:

- `get_entity` returns not found for it;
- `neighbourhood` leaves it out of `entities`, and lists its ID in `unresolved` when a link or the
  start of the walk reaches it.

[The deployment check](../consumers/plug-ins-and-build.md#the-deployment-check) refuses a
`deletedAt` that names no nullable timestamp column of the view's table. In this repo, only the
release view sets it, to `deleted_at`: a GitHub release that GitHub deleted keeps its row, and the
GitHub plug-in's own queries skip it too.

## Aliases

`get_entity` takes one text input, which holds an entity ID or an alias. Text with the form in
[Entity IDs](#entity-ids) is an ID: a lowercase source, a `:`, a lowercase kind, a `:`, and a last
part that is not empty. The API treats any other text as an alias. An alias is the text a person
writes for an entity, such as `acme/api#412` or `https://github.com/acme/api/pull/412` for a pull
request.

To keep aliases, a consumer declares a table beside the table of its entity view, named after that
table with `_alias` added, such as `github_pull_request_alias`. The alias table holds three columns:
`alias`, the text key, `entity_id`, and `updated_at`, the source update time of the newest fact that
names the alias. [The deployment check](../consumers/plug-ins-and-build.md#the-deployment-check)
refuses an alias table of any other shape.

The consumer writes an alias row for the entity of a fact when no row holds the alias, or when the
fact's source update time is newer than the stored `updated_at`. At an equal time, the later fact in
the stream takes the alias, by the rule in
[Writing an entry file](../consumers/plug-ins-and-build.md#writing-an-entry-file). The entity's own
update time is no guide: its newest fact may no longer name the alias.

The consumer must write each alias in lowercase, with no `/` at the end. The API brings the text it
is given to the same form before it looks the text up: it removes white space at both ends, changes
the text to lowercase, and removes one `/` at the end. `Acme/API#412 ` and `acme/api#412` therefore
name one entity.

The API resolves an alias in two store reads:

1. It attaches each consumer that declares an alias table and has a
   [current version](../consumers/host.md#versions). It reads the alias tables in the order of the
   deployment's consumers: plug-in by plug-in as the deployment file lists them, and each plug-in's
   consumers in its own order. The first table that holds the alias gives the entity ID.
2. It reads the entity of that ID as `get_entity` reads any ID: it takes the kind from the ID, finds
   the one consumer that declares the entity view of that kind, and reads that consumer's file, as
   [the core queries](./api.md#the-core-queries) describe. A deleted entity therefore stays not
   found.

In this repo, only the pull request consumer writes aliases, as
[the GitHub plug-in](../plug-ins/github.md#families-and-consumers) describes.

## Links

A consumer declares each link type it writes, with the kind or kinds allowed at each end. The host
checks each link against those types, then writes it to the `link` table in the consumer's own file.
Each row holds:

- `type`, and the entity IDs of the two ends, `from_id` and `to_id`;
- `confidence`, from 0 to 1;
- `evidence`, the ID of the fact the link rests on;
- `scope`, the entity ID that a [scope-mode](../consumers/host.md#a-scope-mode-batch) consumer
  computed the link for, or null for a [fact-mode](../consumers/host.md#a-fact-mode-batch) consumer;
- `origin`, the name of the consumer.

The primary key is `(type, from_id, to_id)`, because one file holds one consumer and `origin` is the
same in every row. The [test store](../consumers/plug-ins-and-build.md#the-test-store) holds every
consumer in one database, so its key adds `origin`.

The host creates a `link` table in every consumer file, even when the consumer declares no link
type. An unlink, the operation that deletes a link, therefore always finds a table. When no link is
stored for its two ends, the host deletes nothing and goes on.

`link_effective` keeps every row of every file, so two consumers that write the same link give two
rows. `neighbourhood` counts such a link once, with the higher confidence. A link type can carry the
hub flag, for a type that joins one entity to many others, and `neighbourhood` follows a hub type
only when the caller asks.

The GitHub and telemetry consumers in this repo write no link, so every link in a deployment comes
from a plug-in outside the repo. The GitHub plug-in answers which release and deploy a pull request
reached with [the delivery query](../plug-ins/github.md#the-delivery-query), which joins its tables
when it runs and stores no link. `neighbourhood` therefore reaches a release or a deploy only
through a link that a plug-in outside this repo writes.
