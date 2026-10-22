# Links

A link connects two entities, usually from different sources: a pull request that closes an issue,
an email that notifies about a review, a fix that changes lines an earlier pull request wrote. Links
are the part of pepys that no single source has. Each link records its origin, its evidence and its
confidence, so a person can see why a link exists and remove it. Every link type declares the entity
kinds it connects, and both the TypeScript types and the host check those kinds.

## Link tables

Any consumer can own a link table in its own file. The link table holds the source entity, the
target, the link type, the origin, an optional scope, a confidence and the evidence. The origin is
the consumer's name, and the host fills it in.

The `link_effective` view unions every link table across the attached files and drops any link that
has a retraction, from any origin. Queries read that view, and each query sets its own confidence
threshold.

A link's target is a global ID or a reference as the text wrote it. No foreign key ties the two
ends, so a link to `github:pr:1874433021` exists before the pull request arrives, and the join fills
in when the pull request lands.

## Two shapes of link

A single-event link comes from one fact that holds both ends, such as "Fixes #412" in a pull request
body. A fact-mode consumer writes it as soon as it reads the fact, and arrival order does not
matter, because a link needs no target row to exist.

A join link needs two facts together, such as a review finding and a later commit that changes the
flagged lines. Whichever fact arrives second must create the link. A scope-mode consumer recomputes
every join link in the scope from the current state on each change, so the link appears once both
facts exist, whatever order they came in. The scope is the smallest unit that holds both sides of
the join: the pull request for review links, the fix pull request for blame links.

## Structural links

Entity consumers write the structural links of their own kind: a review reviews a pull request, a
comment sits in a thread, a message sits in a Gmail thread. Those relations exist as columns in the
entity tables as well, but the neighbourhood walk follows links only, and the structural links let
it see the whole graph.

## Link extractors

| Extractor     | Reads                                                        | Writes                                                        |
| ------------- | ------------------------------------------------------------ | ------------------------------------------------------------- |
| references    | pull request, issue, comment and commit text, and email text | `mentions` and `closes` links                                 |
| notifications | the headers of GitHub notification emails                    | `notifies` links from each email to its pull request or issue |
| changed lines | blame results for merged pull requests                       | `changes_lines_from` links to earlier pull requests           |
| manual        | `link.asserted` and `link.retracted` facts                   | links people and agents assert, and retractions               |

The references extractor matches GitHub URLs, full references such as `acme/api#412`, short
references such as `#412`, closing keywords and commit SHAs. A short reference means the text's own
repository, so the extractor matches it only in GitHub text and skips it in email.

GitHub notification emails carry headers that name their pull request or issue exactly, and a header
that gives the reason the owner received the email, such as a review request or a mention. A
`notifies` link ties each email to its subject with full confidence. It lets "waiting on me" show a
review request once instead of twice, and lets it use the reason.

The changed-lines extractor writes a link for every merged pull request, not only for fixes. Whether
a pull request was a fix, and whether the lines it changed were a regression, is a filter the asker
applies at query time: a title convention, a closing link to a bug issue, or a review finding on
those lines.

## Typed links

Every ID carries its entity kind in its type, and a registry of link types declares which kinds each
link type connects. Building a link of the wrong kinds fails the type check. A reference extracted
from text has its own branded type, and a query cannot use a reference where it needs an ID until
the alias table resolves it.

The brands exist only in TypeScript, and the module boundary passes plain strings. The host
therefore checks the kind prefix of both ends of every link operation against the same registry, and
rejects a link of the wrong kinds.

## Manual and agent links

People and agents assert and retract links through the [API](./api.md), which writes them to the
manual fact stream. A retraction removes a link for every origin. An agent's link carries the
agent's origin, a confidence below full, and required evidence, and every manual fact records the
client that wrote it, so all of one agent's links can be retracted together.
