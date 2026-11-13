# Entities

Entity IDs, entity views, the shared `entity` view, its filter of deleted rows and the alias table
of pull requests are built, as
[entities and links](../../architecture/queries/entities-and-links.md) describes. This design adds
an alias table beside each other entity table, so a readable reference resolves to an ID, the other
GitHub kinds, the Gmail entities, people, and a tombstone for each deletion in every source. Each
source brings the entity consumers for its own kinds.

## Tables and aliases

Each table holds the columns its kind needs, a column with the rest of the source payload as JSON,
and the source update time that orders updates. Beside each table, the consumer owns an alias table
named `<table>_alias`, which maps each alias to its entity ID.

Each entity consumer writes aliases for its entities: readable references, URLs, a pull request's
merge commit SHA, an email's `Message-ID` header. Link extractors store a reference as the text
wrote it, and the query layer resolves it through the alias tables. A rename adds a new alias, and
links written before it keep resolving. `get_entity` returns an entity's aliases beside its rows.

A generic table shared across sources, such as one ticket table for Linear and GitHub issues, waits
until a second source of the same kind exists. With one source per kind, a generic table only loses
detail, and the `kind` column already answers cross-source questions.

An enrichment result never goes onto a source entity's row. It gets its own table and its own owner,
and a view joins the two, so a replay of either consumer leaves the other's data alone.

## GitHub entities

| Kind                  | Stream                             | Facts                                                 |
| --------------------- | ---------------------------------- | ----------------------------------------------------- |
| `repo`                | `facts.github.repository`          | repository events                                     |
| `pull_request_review` | `facts.github.pull_request_review` | pull request review webhooks                          |
| `review_comment`      | `facts.github.review_comment`      | review comment webhooks, review bot findings included |
| `review_thread`       | `facts.github.review_thread`       | review thread webhooks                                |
| `issue_comment`       | `facts.github.issue_comment`       | conversation comments on issues and pull requests     |
| `issue`               | `facts.github.issue`               | issue webhooks and timeline backfill                  |
| `workflow_run`        | `facts.github.workflow_run`        | workflow run webhooks                                 |

Each of these streams already holds facts, so its consumer replays them from the log.

A review thread takes the ID of its first comment. Every reply carries the ID of the comment it
answers, so following those IDs back finds the first comment without another API call.

Check runs, commit statuses, GitHub notifications as a source, and reactions stay out until a
question needs them. Each one becomes a new fact family when it joins.

## Gmail entities

Gmail messages have one fact stream, `facts.gmail.message`, because Gmail reports changes per
message. A message is `gmail:msg:<message ID>`, and an email address is
`gmail:addr:<lowercased address>`. A Gmail thread has no events of its own: it is a grouping, so the
thread consumer builds each thread from its messages in scope mode, with the thread as the scope.
Labels have their own stream, `facts.gmail.label`, and their own consumer. They come from
observations of the label list, because labels have no history API.

## People

Facts name actors by source ID, such as a GitHub user ID or an email address. An identity consumer
groups the IDs that belong to one person into a `person` entity with same-as links. The owner's own
IDs come from the deployment's configuration, so the most important person in the graph is never a
guess. The repository is public, so the IDs never sit in code: ingest reads them from the
`owner-identity` secret ([runtime](./runtime.md#secrets)) and, when they differ from the last
`facts.deployment.owner` fact, appends a new one. That fact is an observation of the entity
`deployment:person:owner`, with the type `deployment.owner.observed` and an observation ID
([log](./log.md#fact-ids)). The identity consumer reads that fact like any other, so it stays pure
and a replay gives the same people. Most email senders never match a GitHub account, and they stay
as a person with an email alias only.

`person` is a hub: an entity linked to thousands of others. The link types that join a person carry
the hub flag, so the neighbourhood walk skips them unless the query asks for them.

## Deletions

A deletion in a source becomes a tombstone. The fact stays in the log, and the entity consumer marks
the row as deleted, so queries skip it by default. This holds for every source, deleted email
included. Each entity consumer marks the delete in the column that its entity view declares as
`deletedAt`, as [the entity view](../../architecture/queries/entities-and-links.md#the-entity-view)
describes.
