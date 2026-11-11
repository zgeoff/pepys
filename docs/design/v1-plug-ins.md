# The plug-ins of v1

Two plug-ins of [pepys v1](./v1.md) live in this repo. The telemetry plug-in stores every log record
of a known coding agent as a fact, and keeps one row per model request and one per reported turn
cost. The GitHub plug-in stores seven fact families, builds pull requests, releases, commits and
deploys from four of them, and ties a pull request to its merge, its first release and its first
deploy when a query runs. Both follow one sketch,
[05-telemetry-github.ts](./v1/sketches/05-telemetry-github.ts). The third plug-in of v1, boxxy,
lives in the boxxy repo and builds against the published kit.

## Telemetry

Sketch: [05-telemetry-github.ts](./v1/sketches/05-telemetry-github.ts), places 1 to 3, types A, flow
parts 1 and 2.

**The paths.** Ingest serves the three standard OTLP paths over HTTP at the root: `/v1/logs`,
`/v1/metrics` and `/v1/traces`. An exporter gets a bare origin and adds the path itself. Log records
become facts. Metrics and traces pass the same token check, get 200 with `{}`, and store nothing, so
an exporter that sends them does not retry for ever.

**The logs path.** Ingest takes OTLP JSON on `/v1/logs`, with or without gzip, up to 1000 facts and
4 MiB in one export. Ingest gives 200 with `{}` for a stored export and for an ignored one, as an
OTLP exporter expects. An exporter drops an export that gets a 4xx, so ingest gives 400 only to a
body that is no OTLP JSON: protobuf, a content type other than `application/json`, text that is not
JSON, or JSON with no `resourceLogs` list. Inside an export, the source skips a malformed part and
drops a malformed record.

**The checks.** An exporter cannot sign a body, so the check is a token in the `authorization`
header. The path also needs a proven sender, through the `SenderProof` port of
[ingest](./v1.md#ingest). The source's read copies the proven sender into the payload of every fact
of the export, as `origin { issuer, subject }`. The origin is the one part of a telemetry fact that
the sender did not write. Each consumer copies it into the `origin_issuer` and `origin_subject`
columns of its table.

**The sender proof.** `createImpIdentitySenderProof` in `@pepys/ingest` reads the `imp-identity`
header and hands the token to an injected verifier, which checks the signature, the issuer, the
audience and the expiry. The issuer and the subject come only from the verified token. Ingest gives
401 to a missing or malformed header, a token the verifier refuses, a verifier that throws, and a
token with no issuer or no subject. Ingest never logs the token.

At start, ingest reads two deployment settings. `PEPYS_IMP_IDENTITY_ISSUERS` holds the path of a
folder of trust documents, one `.json` file per issuing host. `PEPYS_IMP_IDENTITY_AUDIENCE` holds
the audience that a token must name, the same host name that the broker rule which adds the token
uses. When either setting is unset or empty, ingest refuses every export.

**Tolerant parsing.** Neither exporter's shape on the wire is checked, so a consumer takes a number
as a JSON number or as decimal text. A Claude Code record is one whose event name starts with
`claude_code.` or whose scope name starts with `com.anthropic.claude_code`.

**The session.** The session of a record is the value of the `atc.session.id` attribute, read from
the OTLP resource, then from the record. The agent's own session ID is the fallback. The fact's
entity is `telemetry:session:<that value>`. The sender writes those attributes, so the session of a
record proves nothing. Ingest keeps no list of sessions and stores the record with its true origin.
A reader drops a forged record: a query counts a telemetry row for a session only when the row's
origin is the sender that owns the session, which another plug-in's fact gives.

**One record becomes one fact.** The plug-in has one list of products, Claude Code and Codex. The
first product that recognises a record owns it.

- The fact type is `telemetry.<product>.<event>` for an event that the product lists, and
  `telemetry.<product>.unlisted` for any other.
- The time is the one that the product wrote, never the time ingest read the record.
- The fact ID is `event:telemetry:<product>.<event>:<key>`. The key is the event's own key, such as
  a request ID, or a hash of what the product wrote. The hash leaves out the resource and the
  observed time, because a sink that forwards a record may set both again.
- Ingest drops a record of no known product, a record with no session, and a record with no time. It
  logs each with its reason, and a dropped record never refuses the export it came in.

**The consumers.** Both run in fact mode on the one telemetry stream, and each row's key comes from
its fact's ID, so order changes nothing.

| Consumer and table        | One row per              | Cost                                                       |
| ------------------------- | ------------------------ | ---------------------------------------------------------- |
| `telemetry_model_request` | model request            | the cost that the product reports for the request, or null |
| `telemetry_turn_cost`     | turn that reports a cost | the product's own estimate for the turn                    |

Claude Code reports a cost per request. Codex reports no cost for one request and an estimate per
turn. Each product therefore writes cost to exactly one of the two tables, and a sum over both
counts nothing twice. A null cost never becomes 0. A third product is one more entry in the product
list and one more case in each consumer, and the consumer does not compile until the case is there.

`telemetry:session` is an entity kind with no table. A link may point at a session, and `get_entity`
finds none.

## GitHub

Sketch: [05-telemetry-github.ts](./v1/sketches/05-telemetry-github.ts), places 4 and 5, types B,
flow parts 3 to 5.

The source has one webhook route, `/webhook/github`, checked by GitHub's HMAC signature. GitHub
calls from the public internet, so this route is the one public route of v1. A recovery pull reads
the failed deliveries every hour. A resync pull runs every minute and makes no call when nothing is
marked. Both pulls call the API as the GitHub App, so ingest needs three settings and exits at start
without any of them:

| Setting                        | Value                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| `PEPYS_GITHUB_WEBHOOK_SECRET`  | the webhook secret of the App                                              |
| `PEPYS_GITHUB_APP_ID`          | the App ID or the Client ID, which GitHub takes as the JWT issuer          |
| `PEPYS_GITHUB_APP_PRIVATE_KEY` | the App's private key in PEM, with line breaks or with `\n` in their place |

**The recovery pull.** The pull lists the App's webhook deliveries, newest first, back to the
highest delivery ID of its last run. For each delivery that got no 2xx answer, it reads the body
from GitHub's delivery log and builds the fact as the webhook route does, so a delivery that did
arrive is a copy. The cursor is held in memory, so the first run after a start reads the 3 days that
GitHub keeps.

| Webhook event                         | Family                | Built in v1                                  |
| ------------------------------------- | --------------------- | -------------------------------------------- |
| `pull_request`                        | `pull_request`        | `github_pull_request`, `github_release_bump` |
| `release`                             | `release`             | `github_release`                             |
| `push` to the default branch or a tag | `ref`                 | `github_commit`, `github_deploy`             |
| `deployment`, `deployment_status`     | `deployment`          | `github_deploy`                              |
| `workflow_run`                        | `workflow_run`        | nothing: the facts are stored                |
| `issues`                              | `issue`               | nothing: the facts are stored                |
| `pull_request_review`                 | `pull_request_review` | nothing: the facts are stored                |

v1 stores the last three families from the first day and gives them no consumer, because GitHub
redelivers only 3 days back. Any other event answers 202 and stores nothing.

**Fact IDs from the body hash.** The ID of a GitHub fact is `webhook:github:h-<hash>`, where the
hash is the SHA-256 of the canonical JSON of the delivery body. GitHub signs the body and not the
delivery ID header, so only the body may decide the ID. A redelivery keeps the ID. A replay of a
captured body gives the same ID under any header, so it is a copy, and every consumer drops it. The
recovery pull hashes the same canonical form. The delivery ID is required and goes to ingest's log
line, and it is in no fact.

**The tie rule.** For every table that compares `updated_at`, a fact wins when its time is newer
than the stored row's or equal to it, or when no row is stored. It loses only when it is older. On a
tie the later fact in the stream wins, and "later" means the first copy of each fact ID, so the
order is the same on every replay and a replayed body cannot win a tie back. Two more rules keep a
late delivery from undoing a newer state:

- A release that GitHub deleted keeps its row, with the time of the delete in `deleted_at`. No later
  fact clears it, and every reader of the table filters on it.
- The rows that record which release a pull request pins follow the pull request's row: a fact that
  loses writes nothing, and a fact that wins replaces them.

**The resync pull.** The body hash has one cost: a state that goes A, B, A with equal bodies for
both A deliveries. The second A is a copy and is dropped, so the row would stay at B. Ingest marks
an object in two cases:

1. It drops a delivery as a copy of an earlier body, and it stored another body for the same object
   between the two.
2. It stores a body whose time equals the time of the last body it stored for the same object, and
   the two bodies differ.

For each marked pull request or release, the resync pull reads the object from the GitHub API and
writes one fact, of type `github.<family>.resynced`, with the object's own update time and an
`observation:` ID that is a hash of its payload. The payload has the shape of a webhook body, and a
release's payload carries the repository's ID and full name, which the release API leaves out. The
fact arrives after the deliveries, so it wins a tie and sets the row to GitHub's current state. Two
reads that get the same answer are one fact. A replay cannot set a row through the resync: the fact
holds what the API returns at that time, so a replay can cause one API read and nothing more.

The webhook route keeps each fact's API path beside its mark, and the pull reads that path. The pull
skips three kinds of mark, and ingest removes them with the rest:

- a mark of another family, or with no API path;
- an object that GitHub returns 404 for: GitHub deletes no pull request, and shows a draft release
  only to a token that can push, so a 404 proves no delete. A deleted release's own `deleted`
  delivery sets its tombstone;
- a mark in a repository where the App has no installation.

Any other failed call stops the run with no fact stored, and every mark stays for the next run.

The ingest process keeps the marks in memory, for each source that has a resync pull, and the pull
of that source runs in the same process and reads them there. Ingest removes the marks that a run
read only after the run's whole batch is stored, so a failed run keeps every mark. A restart loses
every mark, and an object that loses its mark keeps a stale row until its next delivery.

**Deploys.** Two signals report a deploy, and one table holds both: a push that moves a tag that
matches the deploy tag pattern, and a deployment status of `success`. The pattern is a
[setting](./v1.md#plug-ins-and-compile-time-settings) of the plug-in, `deployed/<environment>` by
default, and one more part of the tag is a target. For one repository and environment, a query reads
the tag rows when there are any, and the status rows otherwise. A row keeps the earliest time that
its signal reported its commit, so a second report changes nothing.

**The delivery query.** One query module holds the rules that tie a pull request to three times: its
merge, the first published release of its repository that contains its merge commit, and the first
deploy, to one environment, of a commit that pins such a release. The tie is made when a query runs
and never when a fact arrives, so it is right in any arrival order. The plug-in serves the module as
the query `github_pull_request_delivery`, and a query of another plug-in can call the module and
join its result. v1 writes no link for the tie, so `neighbourhood` does not show a pull request's
release.
