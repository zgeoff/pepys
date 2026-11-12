# Entities

An entity is one record from one source: a pull request, a review, an email message. Each entity
consumer owns a full table for its kind, with every column that kind needs, plus a view named
`entity` with six fixed columns that every kind shares. Cross-source queries read the shared view,
and queries about one kind read its full table. Entities are named by stable global IDs, and an
alias table maps the readable forms people write to those IDs. Each source brings the entity
consumers for its own kinds. The sections below cover the GitHub, telemetry and Gmail sources.

## Tables and the entity view

Each table is per source, such as `github_pull_request` or `gmail_message`. It holds the columns its
kind needs, a column with the rest of the source payload as JSON, and the source update time that
orders updates. Beside each table, the consumer owns an alias table named `<table>_alias`, which
maps each alias to its entity ID.

The `entity` view in each consumer file selects six columns from that file's tables: ID, kind,
title, URL, actor and update time. The query layer attaches every consumer file and unions their
views into one cross-source view. The view adds no copy of the data, so the full table and the
shared view cannot disagree.

A generic table shared across sources, such as one ticket table for Linear and GitHub issues, waits
until a second source of the same kind exists. With one source per kind, a generic table only loses
detail, and the `kind` column already answers cross-source questions.

## IDs and aliases

An entity ID has the form `<source>:<kind>:<id>`, built from the source's database ID when the
source gives one: `github:pull_request:1874433021`, `github:user:583231`, `gmail:msg:18c4f2a9b01e`.
Database IDs survive a repository rename or a login change, which readable forms such as
`acme/api#412` do not. A kind is lowercase with `_` between words, such as `review_comment`.

These kinds have no database ID, so their last part is built from other fields:

- An email address is `gmail:addr:<lowercased address>`.
- The owner is `deployment:person:owner` ([people](#people)).
- A GitHub ref is `github:ref:<repository ID>:<ref>`, such as `github:ref:902:refs/heads/main`.
- A GitHub deploy is `github:deploy:<repository ID>:<environment>:<signal>:<sha>`, with `:<target>`
  after it when the report names a target. The signal is `tag` or `deployment_status`, and
  [the GitHub plug-in](../v1-plug-ins.md#github) gives the rules for each.
- A telemetry session is `telemetry:session:<session ID>`, with the session ID that the log record
  carries.
- A telemetry model request or turn cost is `telemetry:<kind>:<product>.<event>:<key>`, the ID of
  the fact it comes from with its `event:telemetry:` prefix cut.
  [The telemetry plug-in](../v1-plug-ins.md#telemetry) defines the product, the event and the key.

Each entity consumer writes aliases for its entities: readable references, URLs, a pull request's
merge commit SHA, an email's `Message-ID` header. Link extractors store a reference as the text
wrote it, and the query layer resolves it through the alias tables. A rename adds a new alias, and
links written before it keep resolving.

## GitHub entities

| Kind                  | Stream                             | Facts                                                 |
| --------------------- | ---------------------------------- | ----------------------------------------------------- |
| `repo`                | `facts.github.repository`          | repository events                                     |
| `pull_request`        | `facts.github.pull_request`        | pull request webhooks and timeline backfill           |
| `pull_request_review` | `facts.github.pull_request_review` | pull request review webhooks                          |
| `review_comment`      | `facts.github.review_comment`      | review comment webhooks, review bot findings included |
| `review_thread`       | `facts.github.review_thread`       | review thread webhooks                                |
| `issue_comment`       | `facts.github.issue_comment`       | conversation comments on issues and pull requests     |
| `commit`              | `facts.github.commit`              | push webhooks                                         |
| `issue`               | `facts.github.issue`               | issue webhooks and timeline backfill                  |
| `release`             | `facts.github.release`             | release webhooks                                      |
| `ref`                 | `facts.github.ref`                 | pushes to the default branch or to a tag              |
| `deployment`          | `facts.github.deployment`          | deployment and deployment status webhooks             |
| `workflow_run`        | `facts.github.workflow_run`        | workflow run webhooks                                 |

The `github_deploy` consumer builds one more kind, `deploy`, from the `ref` and `deployment` facts:
one entity per signal that reported a commit to an environment. A `deployment` is GitHub's own
deployment object, and a `deploy` is pepys's record that a commit reached an environment, whichever
signal reported it.

A review thread takes the ID of its first comment. Every reply carries the ID of the comment it
answers, so following those IDs back finds the first comment without another API call.

Check runs, commit statuses, GitHub notifications as a source, and reactions stay out until a
question needs them. Each one becomes a new fact family when it joins.

## Telemetry entities

The telemetry source has one stream, `facts.telemetry.log_record`. Each fact is one OTLP log record
of a coding agent, and its entity is the agent's session, of the kind `session`. Two consumers build
the other kinds from those facts:

| Kind            | Consumer                  | Rows                                |
| --------------- | ------------------------- | ----------------------------------- |
| `model_request` | `telemetry_model_request` | one per model request               |
| `turn_cost`     | `telemetry_turn_cost`     | one per turn cost the agent reports |

Both tables join to the session through their `session_id` column.

## Gmail entities

Gmail messages have one fact stream, `facts.gmail.message`, because Gmail reports changes per
message. A Gmail thread has no events of its own: it is a grouping, so the thread consumer builds
each thread from its messages in scope mode, with the thread as the scope. Labels have their own
stream, `facts.gmail.label`, and their own consumer. They come from observations of the label list,
because labels have no history API.

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

`person` is a hub kind: an entity linked to thousands of others. An entity kind's declaration
carries the hub flag, and the [neighbourhood walk](./api.md#the-core-catalog) skips hub kinds unless
the query asks for them.

## Deletions

A deletion in a source becomes a tombstone. The fact stays in the log, and the entity consumer marks
the row as deleted, so queries skip it by default. This holds for every source, deleted email
included.

A consumer's entity view declaration may name a deleted-at column, and the generated `entity` view
then leaves out every row where that column is set.
