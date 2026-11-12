# The GitHub plug-in

The GitHub plug-in, `@pepys/source-github`, stores the webhooks of a GitHub App as facts in seven
families, and builds pull requests, releases, commits and deploys from four of them. Its one
question is when a pull request reached its users: a query ties each pull request to its merge, its
first release and its first deploy when the query runs, so the answer is right in any order the
facts arrived. Every fact ID comes from a hash of the webhook body, because GitHub signs the body
and not the header that names the delivery. Two pulls fill the gaps that webhooks leave: a recovery
pull reads the deliveries that failed, and a resync pull reads an object whose newest state a copy
of an older body could hide.

[Ingest](../ingest/ingest.md) covers the receive route and the pull timers that this plug-in fills
in. [Entities and links](../queries/entities-and-links.md) covers the entity IDs.

## The route and the settings

The source has one webhook route, `/webhook/github`, checked by GitHub's HMAC signature in
`x-hub-signature-256`. GitHub calls from the public internet, so the route carries the public reach
mark. Ingest exits at start without any of these settings:

| Setting                        | Value                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| `PEPYS_GITHUB_WEBHOOK_SECRET`  | the webhook secret of the App                                              |
| `PEPYS_GITHUB_APP_ID`          | the App ID or the Client ID, which GitHub takes as the JWT issuer          |
| `PEPYS_GITHUB_APP_PRIVATE_KEY` | the App's private key in PEM, with line breaks or with `\n` in their place |

A delivery with no delivery ID header, or a body that is not JSON, gets 400, and a body that does
not fit its event gets 422. An event or action that the plug-in does not list gets 202 and stores
nothing.

## Families and consumers

| Webhook event                         | Family                | Built by                      |
| ------------------------------------- | --------------------- | ----------------------------- |
| `pull_request`                        | `pull_request`        | `github_pull_request`         |
| `release`                             | `release`             | `github_release`              |
| `push` to the default branch or a tag | `ref`                 | `github_ref`, `github_deploy` |
| `deployment`, `deployment_status`     | `deployment`          | `github_deploy`               |
| `workflow_run`                        | `workflow_run`        | nothing: the facts are stored |
| `issues`                              | `issue`               | nothing: the facts are stored |
| `pull_request_review`                 | `pull_request_review` | nothing: the facts are stored |

The plug-in stores the last three families with no consumer, because GitHub keeps each delivery for
a few days only, and a consumer added later replays them from the log. `github_pull_request` writes
two tables: the pull request, and `github_release_bump`, one row for each release URL in the pull
request's body. `github_ref` writes `github_commit`, one row per commit of a push.

A delivery that embeds a copy of another object, such as the pull request inside a review event,
updates nothing of that object: only the object's own facts change its state.

## Fact IDs from the body hash

The ID of a GitHub fact is `webhook:github:h-<hash>`, where the hash is the SHA-256 of the canonical
JSON of the delivery body. GitHub signs the body and not the delivery ID header, so only the body
may decide the ID. A redelivery keeps the ID, and a replay of a captured body gives the same ID
under any header, so every consumer drops it as a copy. The recovery pull hashes the same canonical
form. The delivery ID goes to ingest's log line, and into no fact.

## The tie rule

For every table that compares update times, a fact wins when its time is newer than the stored row's
or equal to it, or when no row is stored. It loses only when it is older. On a tie, the later fact
in the stream wins, and "later" means the first copy of each fact ID, so the order is the same on
every replay, and a replayed body cannot win a tie back. A pull request fact with the stored time
and an equal row writes nothing. A release's time is its `updated_at`, then its `published_at`, then
its `created_at`, the first one GitHub sets.

Two more rules keep a late delivery from undoing a newer state:

- A release that GitHub deleted keeps its row, with the time of the delete in `deleted_at`. No later
  fact clears it.
- The release bump rows of a pull request follow its row: a fact that loses writes nothing, and a
  fact that wins replaces them, from the stored payload of the body it replaces.

## The recovery pull

GitHub retries no failed delivery by itself. Every hour, the recovery pull lists the App's webhook
deliveries, newest first, back to the highest delivery ID of its last run. For each delivery that
got no 2xx answer, oldest first, it reads the body from GitHub's delivery log and builds the fact as
the webhook route does, so a delivery that did arrive is a copy. The cursor is held in memory, so
the first run after a start reads every delivery that GitHub still keeps. A delivery too large for
one append of the log is logged with its delivery ID and skipped.

## The resync pull

The body hash has one cost. When a state goes A, B, A with equal bodies for both A deliveries, the
second A is a copy and is dropped, and the row would stay at B. The webhook route therefore marks an
object in two cases:

1. It drops a delivery as a copy of an earlier body, and it stored another body for the same object
   between the two.
2. It stores a body whose time equals the time of the last body it stored for the same object, and
   the two bodies differ.

Every minute, the resync pull reads each marked pull request or release from the GitHub API, at the
API path the route kept beside the mark, and writes one fact of type `github.<family>.resynced`. The
fact has the object's own update time, and an `observation:` ID that hashes its payload with the
last body ingest stored for the object. The payload has the shape of a webhook body: a release's
carries the repository's ID and full name, which the release API leaves out, so the pull makes a
second call for them. The fact arrives after the deliveries, so it wins the tie, and the row takes
GitHub's current state.

Two reads with the same answer after the same stored body are one fact. A read after a newer stored
body is a new fact, so a resync sets the row back after a later tied delivery even when GitHub's
answer has not changed. A replay cannot set a row through the resync, because the fact holds what
the API returned at that time.

The pull skips three kinds of mark, and ingest removes them with the rest:

- a mark of another family, or with no API path;
- an object that GitHub answers 404 for, because GitHub deletes no pull request, and shows a draft
  release only to a token that can push, so a 404 proves no delete;
- a mark in a repository where the App has no installation.

A 401 from GitHub rejects the run. Any other failed call stops the run with no fact stored, and
every mark stays for the next run a minute later.

## Deploys

Two signals report a deploy, and `github_deploy` keeps both in one table: a push that moves a tag
matching the deploy tag pattern, and a deployment status of `success`. The pattern is the plug-in's
one setting, `deployed/<environment>` by default, and it must name `<environment>` exactly once. One
more part after it names a target. A push that deletes the tag reports nothing. A row keeps the
earliest time that its signal reported its commit, so a second report changes nothing.

## The delivery query

`github_pull_request_delivery` takes up to 200 pull requests, an environment and an optional target,
and returns each pull request's merge time, its first release and its first deploy. The plug-in
exports the statement as `githubDelivery`, so a query of another plug-in can join its result. The
tie is made when the query runs and never when a fact arrives, so it is right in any arrival order.
No link records it.

- **The first release** of a pull request is the earliest published release of its repository that
  is no draft, is not deleted, and whose target commit is no older than the merge commit. The query
  compares commit times, from `github_commit`, and falls back to the release's and the pull
  request's own times when the commit is not stored. It checks no commit ancestry.
- **The first deploy** is the earliest deploy, to the environment and target, of a repository with a
  merged pull request whose body links a release that contains the first pull request, and whose
  deployed commit is no older than that pull request's merge. For one repository and environment,
  the query reads the tag rows when there are any, and the deployment status rows otherwise.

## Known limits

- The tie by commit time is not ancestry: a release cut from another branch after the merge counts
  as containing it.
- A bump in two steps reports the deploy early. A repository with several release components gets
  the first release of any of them. A repository that deploys itself with no bump pull request gets
  no deploy time.
- An object whose resync mark is lost to a restart keeps a stale row until its next delivery.
