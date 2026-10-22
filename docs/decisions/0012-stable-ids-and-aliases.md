# 0012: Stable IDs from source database IDs, with aliases

Date: 2026-10-22

## Decision

An entity ID has the form `<source>:<kind>:<id>` and uses the source's database ID. An alias table
maps readable forms, URLs, merge commit SHAs and message IDs to entity IDs. Link extractors store
references as written, and queries resolve them through the alias table.

## Rejected alternatives

| Option                              | Why not                                                          |
| ----------------------------------- | ---------------------------------------------------------------- |
| readable IDs such as `acme/api#412` | break when a repository is renamed or a user changes their login |

## Why

Database IDs never change, so links never break. Aliases keep readable references working, and a
rename only adds an alias.
