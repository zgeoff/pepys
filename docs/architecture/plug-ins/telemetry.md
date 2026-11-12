# The telemetry plug-in

The telemetry plug-in, `@pepys/source-telemetry`, takes the OpenTelemetry log records that coding
agents export, and stores each record of a known product as a fact. It keeps one row per model
request and one per turn cost that an agent reports, so a query can sum what a session's work cost
without counting anything twice. An exporter cannot sign a body, so the route checks a token and
also needs a proven sender, and each fact records that sender as its origin. The session a record
names is the sender's own word, so a reader trusts a row only when its origin owns the session.

[Ingest](../ingest/ingest.md#the-sender-proof) covers the sender proof port.
[Entities and links](../queries/entities-and-links.md) covers the telemetry entity IDs.

## The paths

Ingest serves the three standard OTLP paths over HTTP at the root: `/v1/logs`, `/v1/metrics` and
`/v1/traces`, because an exporter that gets a bare origin adds the path itself. Log records become
facts. Metrics and traces pass the same checks, get 200 with `{}`, and store nothing, because an
exporter retries a refusal for ever.

`/v1/logs` takes OTLP JSON, with or without gzip, and sets larger body and fact limits than a
default path, because an exporter sends many records in one export. Ingest answers 200 with `{}` for
a stored export and for an ignored one, as an OTLP exporter expects. An exporter drops an export
that gets a 4xx, so ingest gives 400 only to a body that cannot be OTLP JSON: a content type other
than JSON, text that is not JSON, JSON that is no object, or a `resourceLogs` that is no list. An
object with no `resourceLogs` is an empty export. Inside an export, the source skips a malformed
part and drops a malformed record.

## The checks

The token is `PEPYS_TELEMETRY_TOKEN`, in the `authorization` header, bare or after `Bearer`. The
sender proof is a worker machine's signed identity token in the `imp-identity` header, verified
against the trust documents in the folder at `PEPYS_IMP_IDENTITY_ISSUERS` for the audience in
`PEPYS_IMP_IDENTITY_AUDIENCE`. The audience is the name that the broker rule which adds the token
uses. The issuer and the subject come only from the verified token, and the source's read stores
them in the payload of every fact of the export as `origin { issuer, subject }`. Each consumer
copies the origin into its `origin_issuer` and `origin_subject` columns. Ingest never logs the
token.

## One record becomes one fact

The plug-in has one list of products, Claude Code and Codex, and the first product that recognises a
record owns it. A Claude Code record is one whose event name starts with `claude_code.` or whose
scope name starts with `com.anthropic.claude_code`.

- The fact type is `telemetry.<product>.<event>` for an event the product lists, and
  `telemetry.<product>.unlisted` for any other.
- The time is the one the product wrote, from the record's `event.timestamp` attribute, then its own
  time, and never the time ingest read it.
- The fact ID is `event:telemetry:<product>.<event>:<key>`. The key is the event's own key, such as
  a request ID, or `h-` and a SHA-256 of the session, the event name, the record's time, its body
  and its sorted attributes. The hash leaves out the resource and the observed time, because a sink
  that forwards a record may set both again.
- The session of a record is the `atc.session.id` attribute of the resource, then of the record,
  then the agent's own session ID. The fact's entity is `telemetry:session:<that value>`.

Ingest drops a record of no known product, a record with no session, and a record with no time, and
logs one warning per export with a count for each reason. A dropped record never refuses the export
it came in. Neither exporter's wire shape is pinned, so a consumer takes a number as a JSON number
or as decimal text.

## The consumers

Both consumers run in fact mode on the one stream, `facts.telemetry.log_record`, and each row's key
comes from its fact's ID, so order changes nothing.

| Consumer and table        | One row per              | Built from                                                      |
| ------------------------- | ------------------------ | --------------------------------------------------------------- |
| `telemetry_model_request` | model request            | a Claude Code `api_request`, a Codex `response.completed` event |
| `telemetry_turn_cost`     | turn that reports a cost | a Codex `turn_cost` record                                      |

Claude Code reports a cost per request. Codex reports no cost for one request and an estimate per
turn. Each product therefore writes cost to exactly one of the two tables, and a sum over both
counts nothing twice. A model request's `cost_basis` holds whether the product reported a cost, and
a null cost never becomes 0. A record with no model or no token counts makes no row. A third product
is one more entry in the product list and one more case in each consumer, and the consumer does not
compile until the case is there.

`telemetry:session` is an entity kind with no table: a link may point at a session, and `get_entity`
finds none.

## The query

`telemetry_session_model_requests` returns the model requests of one session, oldest first. The
caller names the session by its full ID, `telemetry:session:<id>`, and the sender that owns it, as
an issuer and a subject, and the query leaves out each row whose origin is another sender.

The sender writes the session attribute, so the session of a record proves nothing on its own.
Ingest keeps no list of sessions, and stores each record with its true origin. A query drops a
forged record by counting a row for a session only when the row's origin is the sender that owns the
session, which another plug-in's fact gives.

## Known limits

- A record under another sender's session is stored. A query that reads the telemetry tables without
  the join to the session's owner shows it.
- The sender also writes the time of a record, so a worker can move its own cost between its own
  attempts. Sessions on one machine are one sender.
- A session that can prove no sender cannot send telemetry at all, and until the trust documents and
  audience are set, every export is refused and every attempt's cost reads as none.
- One fact ID can have two sessions: the fact ID leaves the resource out, and the session comes from
  the resource first. When a sink rewrites the resource between two copies of one record, the first
  copy in the log wins.
- The model request's `agent` column is null, because no known attribute names the subagent of a
  request.
- Storing every log record costs log space, because tool and hook events outnumber model requests.
