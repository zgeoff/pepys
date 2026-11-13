# The telemetry plug-in

The telemetry plug-in, `@pepys/source-telemetry`, stores the OpenTelemetry log records that Claude
Code and Codex export, one fact per record. Its two consumers write two tables: one row for each
model request, and one row for each turn of a session that reports a cost. A caller adds up what a
session cost from the two tables without counting anything twice.

Each export carries two tokens. An OTLP exporter cannot sign a body, so ingest checks a shared token
in place of a signature. Ingest also checks the identity token of the machine that sent the export,
and each fact keeps that machine's identity as its origin. The exporter writes each record's session
ID itself, so one machine can send records under the session ID of a session that runs on another
machine. A caller therefore trusts a row for a session only when the row's origin is the machine
that runs that session.

atc, the tool that runs agent sessions, stamps an `atc.session.id` attribute on every record of a
session it runs.

[Ingest](../ingest/ingest.md#the-sender-proof) covers the identity check.
[The host](../consumers/host.md#a-fact-mode-batch) covers how it applies each fact ID once.
[Entities and links](../queries/entities-and-links.md) covers the telemetry entity IDs.

## The paths

Ingest serves the three standard OTLP paths over HTTP at the root of its own URL, because an
exporter that is given a bare URL adds the path itself:

| Path          | Takes                                           | Stores      |
| ------------- | ----------------------------------------------- | ----------- |
| `/v1/logs`    | OTLP JSON, with or without gzip                 | each record |
| `/v1/metrics` | anything that passes both [checks](#the-checks) | nothing     |
| `/v1/traces`  | anything that passes both [checks](#the-checks) | nothing     |

Ingest answers 200 with `{}` to every export it accepts on any of the three, so an exporter set to
send all three signals sees each export succeed.

An export holds many records, so `/v1/logs` takes a larger body and more facts than ingest's other
routes take. The plug-in file,
[`telemetry-plugin.ts`](../../../packages/source-telemetry/src/telemetry-plugin.ts), sets both
limits:

| Limit               | Default for a route | `/v1/logs` |
| ------------------- | ------------------- | ---------- |
| body size, in bytes | 1,048,576           | 4,194,304  |
| facts in one export | 100                 | 1,000      |

An exporter drops an export that gets a 4xx. Ingest therefore answers 400 only when the
`Content-Type` is not `application/json`, or the body is not OTLP JSON in shape. In an export of the
right shape, the source's `read` function, which turns the export into facts, skips each resource,
scope, log record or attribute of the wrong shape, and keeps the rest.

Set each exporter to send JSON, because ingest answers 400 to OTLP protobuf: `http/json` as the
protocol of Claude Code, and `json` as the protocol of Codex's `otlp-http` exporter. Claude Code
sends gzip when `OTEL_EXPORTER_OTLP_COMPRESSION` is `gzip`, and Codex sends no gzip. Each exporter
sends at most 512 records in one export by default, and a record is about 2 kB to 3 kB, so a full
export is under both limits.

## The checks

1. Ingest checks the shared token, `PEPYS_TELEMETRY_TOKEN`, in the `authorization` header, bare or
   after `Bearer`. Ingest never logs it.
2. Ingest checks the signed identity token in the `imp-identity` header, which the machine gets from
   its token broker. Ingest checks it against the issuers in the folder of trust documents at
   `PEPYS_IMP_IDENTITY_ISSUERS`, and against the audience in `PEPYS_IMP_IDENTITY_AUDIENCE`. Ingest
   reads both variables from its environment at start, as
   [the sender proof](../ingest/ingest.md#the-sender-proof) describes.
3. When either token is missing or fails its check, ingest answers 401, and the exporter drops the
   export.

`read` takes the issuer and the subject only from the verified identity token. It stores the pair as
`origin { issuer, subject }` in the payload of every fact of the export, and each consumer copies
the pair into its `origin_issuer` and `origin_subject` columns. One origin stands for one machine.

## One record becomes one fact

`read` first finds the product that wrote the record, and the event. It tries Claude Code, then
Codex:

| Product     | The record has                                                                 | The event                     |
| ----------- | ------------------------------------------------------------------------------ | ----------------------------- |
| Claude Code | an `event.name` that starts with `claude_code.`                                | the name after `claude_code.` |
| Claude Code | a scope name that starts with `com.anthropic.claude_code`, and an `event.name` | the whole `event.name`        |
| Codex       | an `event.name` that starts with `codex.`                                      | the name after `codex.`       |

The event name `claude_code.api_request`, for example, gives the event `api_request`. Each product's
file under [`products/`](../../../packages/source-telemetry/src/products/) lists the events it
knows, and `products.ts` in that folder holds the list of products.

The session is the first of these that holds a value:

1. the `atc.session.id` attribute of the record's resource;
2. the `atc.session.id` attribute of the record;
3. the product's own session attribute: `session.id` for Claude Code, and `conversation.id` for
   Codex.

Every fact goes to the one stream, `facts.telemetry.log_record`. `read` builds each fact from these
parts:

| Part               | Value                                                                |
| ------------------ | -------------------------------------------------------------------- |
| type, listed event | `telemetry.<product>.<event>`                                        |
| type, other event  | `telemetry.<product>.unlisted`                                       |
| entity             | `telemetry:session:<session>`                                        |
| time               | the record's `event.timestamp` attribute, else its `timeUnixNano`    |
| ID                 | `event:telemetry:<product>.<event>:<key>`, for an unlisted event too |

Ingest's clock never sets a fact's time. The key in the ID is the first of these that the record
holds:

1. the event's own key, where the product defines one: the `request_id` of a Claude Code request,
   error or refusal, or the `client_request_id` of a request or an error with no `request_id`,
   `t-<session.id>:<tool_use_id>` for a Claude Code tool result, and the `turn.id` of a Codex turn
   cost;
2. for Claude Code, `s-<session.id>:<event.sequence>`, for a listed or an unlisted event;
3. `h-` and a SHA-256 of these parts of the record: the product's own session ID, the event name,
   `timeUnixNano`, the body, and the attributes sorted by name.

In the two Claude Code keys, `<session.id>` is Claude Code's own `session.id` attribute, even when
the fact's session comes from `atc.session.id`.

- The event name is part of the ID, so a Claude Code `api_request` and the `api_error` that shares
  its request ID make two facts.
- The hash leaves out the resource and `observedTimeUnixNano`, the time a collector first saw the
  record, because a collector that forwards a record may set both again.

`read` drops a record of no known product, a record with no session and a record with no time, and
logs one warning per export with a count for each reason. A dropped record never refuses the rest of
its export.

## The consumers

| Consumer and table        | One row per              | Product     | Built from                                                      |
| ------------------------- | ------------------------ | ----------- | --------------------------------------------------------------- |
| `telemetry_model_request` | model request            | Claude Code | an `api_request` event                                          |
| `telemetry_model_request` | model request            | Codex       | an `sse_event` event whose `event.kind` is `response.completed` |
| `telemetry_turn_cost`     | turn that reports a cost | Codex       | a `turn_cost` event                                             |

Both consumers run in [fact mode](../consumers/host.md#a-fact-mode-batch) on
`facts.telemetry.log_record`, and each takes a row's key from its fact's ID. The host applies each
fact ID once, at its first position in the stream, and skips each later fact with the same ID. Two
facts with different IDs give the same rows in either order.

Claude Code reports a cost per request. Codex reports no cost for one request, and an estimate per
turn. Each product's cost therefore lands in exactly one of the two tables, and a sum over both
counts nothing twice.

- The model request consumer writes `cost_basis` as `reported` when the product reported a cost, and
  as `none` when it did not. It leaves a missing cost null, never 0.
- The model request consumer skips a record that lacks a model or token counts.
- The turn cost consumer needs only the cost. Codex's estimate can come without a model, so the
  consumer writes that turn with a null model.
- Each consumer reads a number from a JSON number or from decimal text. Claude Code writes a count
  as a JSON number, and Codex writes a count as decimal text.

The consumers import no ingest code, so they keep their own list of product names, in
[`consumers/products/types.ts`](../../../packages/source-telemetry/src/consumers/products/types.ts).
A test holds that list equal to the list in `products.ts`.

## The query

The API serves the query `telemetry_session_model_requests` under `/rpc`. It returns the model
requests of one session, oldest first. The caller passes:

- the session, by its full ID, `telemetry:session:<id>`;
- the issuer of the origin that runs the session;
- the subject of that origin.

The query returns only the rows of that origin. A record that carries another machine's session ID
stays in the table, under its true origin, and this filter leaves it out of the result.

Ingest and the plug-in never record which machine runs a session. The caller must know the origin of
that machine from outside this plug-in.

## Known limits

- A query that reads the telemetry tables without the origin filter counts records that another
  machine wrote under the session's ID.
- A machine writes the time of each of its records, so it can move its own records to another time.
  It can never write a row under another machine's origin.
- Every session on one machine has the same origin, so a caller can never use the origin to tell two
  sessions on one machine apart.
- A machine that cannot prove its identity cannot send telemetry. While the trust documents or the
  audience are unset, ingest answers 401 to every export, and the exporter drops each one.
- Two copies of one record get one fact ID even when a collector rewrote the resource between them,
  because the ID leaves the resource out. When the rewrite changed `atc.session.id`, the two copies
  name two sessions. The host applies the copy that comes first in the stream and skips the second,
  so the row stays under the first copy's session.
- A Claude Code event with no key of its own is keyed by its session and `event.sequence`. If Claude
  Code starts the sequence again when a session resumes under the same `session.id`, a later event
  gets the ID of an earlier one, and the host skips the later event with no error.
- The model request's `agent` column is always null: `read` recognises no attribute from either
  product as the subagent of a request.
- The log keeps every record of a known product, tool and hook events included, though only model
  requests and turn costs become rows.
- Codex signed in with a ChatGPT account sends no `turn_cost` event, so its sessions have no cost in
  either table. Whether Codex with an API key sends one is not checked.
- Codex's exporter sends each export once. When ingest answers 503, Claude Code sends the same
  export again, and Codex never does, so that export's records are lost.
- Codex writes `atc.session.id` on the resource only, and its `api_request` records carry no
  `conversation.id`. Without `atc.session.id`, `read` drops those records.
- One Codex turn can send several `response.completed` events, such as one for the model that
  reviews a command. Each one becomes a model request row.
