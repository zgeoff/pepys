# Entities

An entity is one record from one source: a pull request, a review, an email message. Each entity
consumer owns a full table for its kind, with every column that kind needs, plus a view named
`entity` with six fixed columns that every kind shares. Cross-source queries read the shared view,
and queries about one kind read its full table. Entities are named by stable global IDs, and an
alias table maps the readable forms people write to those IDs.

## Tables and the entity view

Each table is per source, such as `github_pull_request` or `gmail_message`. It holds the columns its
kind needs, a column with the rest of the source payload as JSON, and the source update time that
orders updates.

The `entity` view in each consumer file selects six columns from that file's tables: ID, kind,
title, URL, actor and update time. The query layer attaches every consumer file and unions their
views into one cross-source view. The view adds no copy of the data, so the full table and the
shared view cannot disagree.

A generic table shared across sources, such as one ticket table for Linear and GitHub issues, waits
until a second source of the same kind exists. With one source per kind, a generic table only loses
detail, and the `kind` column already answers cross-source questions.

## IDs and aliases

An entity ID has the form `<source>:<kind>:<id>`, built from the source's database ID:
`github:pr:1874433021`, `github:user:583231`, `gmail:msg:18c4f2a9b01e`. Database IDs survive a
repository rename or a login change, which readable forms such as `acme/api#412` do not.

Each entity consumer writes aliases for its entities: readable references, URLs, a pull request's
merge commit SHA, an email's `Message-ID` header. Link extractors store a reference as the text
wrote it, and the query layer resolves it through the alias table. A rename adds a new alias, and
links written before it keep resolving.

## GitHub entities

| Kind           | Stream                        | Facts                                                 |
| -------------- | ----------------------------- | ----------------------------------------------------- |
| repository     | `facts.github.repository`     | repository events                                     |
| pull request   | `facts.github.pull_request`   | pull request webhooks and timeline backfill           |
| review         | `facts.github.review`         | review webhooks                                       |
| review comment | `facts.github.review_comment` | review comment webhooks, review bot findings included |
| review thread  | `facts.github.review_thread`  | review thread webhooks                                |
| issue comment  | `facts.github.issue_comment`  | conversation comments on issues and pull requests     |
| commit         | `facts.github.commit`         | push webhooks                                         |
| issue          | `facts.github.issue`          | issue webhooks and timeline backfill                  |

A review thread takes the ID of its first comment. Every reply carries the ID of the comment it
answers, so following those IDs back finds the first comment without another API call.

Check runs, CI status, GitHub notifications as a source, and reactions stay out until a question
needs them. Each one becomes a new fact family when it joins.

## Gmail entities

Gmail has one fact stream, `facts.gmail.message`, because Gmail reports changes per message. A Gmail
thread has no events of its own: it is a grouping, so the thread consumer builds each thread from
its messages in scope mode, with the thread as the scope. Labels come from observations of the label
list, because labels have no history API.

## People

Facts name actors by source ID, such as a GitHub user ID or an email address. An identity consumer
groups the IDs that belong to one person into a `person` entity with same-as links. The deployment
declares which IDs belong to the owner, so the most important person in the graph is never a guess.
Most email senders never match a GitHub account, and they stay as a person with an email alias only.

## Deletions

A deletion in a source becomes a tombstone. The fact stays in the log, and the entity consumer marks
the row as deleted, so queries skip it by default. This holds for every source, deleted email
included.
