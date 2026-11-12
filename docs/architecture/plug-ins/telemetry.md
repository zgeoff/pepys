# The telemetry plug-in

The telemetry plug-in, `@pepys/source-telemetry`, stores the OpenTelemetry log records that Claude
Code and Codex export, one fact per record. Its two consumers keep one row per model request and one
per turn cost, so a caller can add up what a session cost without counting anything twice.

Each export carries two tokens. An OTLP exporter cannot sign a body, so ingest checks a shared token
in place of a signature. Ingest also checks the identity token of the machine that sent the export,
and each fact keeps that machine's identity as its origin. The exporter writes each record's session
ID itself, so a caller trusts a row for a session only when the row's origin is the machine that
runs that session.

[Ingest](../ingest/ingest.md#the-sender-proof) covers the identity check.
[Entities and links](../queries/entities-and-links.md) covers the telemetry entity IDs.

## The paths

Ingest serves the three standard OTLP paths over HTTP at the root, because an exporter that is given
a bare URL adds the path itself:

| Path          | Takes                            | Stores      |
| ------------- | -------------------------------- | ----------- |
| `/v1/logs`    | OTLP JSON, with or without gzip  | each record |
| `/v1/metrics` | anything that passes both checks | nothing     |
| `/v1/traces`  | anything that passes both checks | nothing     |

Ingest answers 200 with `{}` to every export it accepts on any of the three, so an exporter set to
send all three signals sees each export succeed. An export holds many records, so `/v1/logs` takes a
larger body than ingest's other paths, and ten times as many facts per export. `telemetry-plugin.ts`
sets both limits.

An exporter drops an export that gets a 4xx. Ingest therefore answers 400 only when the body is not
OTLP JSON in shape. In an export of the right shape, the source's `read` function, which turns the
export into facts, skips each part of the wrong shape and keeps the rest.

## The checks

1. Ingest checks the shared token, `PEPYS_TELEMETRY_TOKEN`, in the `authorization` header, bare or
   after `Bearer`. Ingest never logs it.
2. Ingest checks the identity token in the `imp-identity` header against the trust documents in the
   folder at `PEPYS_IMP_IDENTITY_ISSUERS`, and against the audience in
   `PEPYS_IMP_IDENTITY_AUDIENCE`. The deployment sets both.
3. When either token is missing or fails its check, ingest answers 401, and the exporter drops the
   export.

`read` takes the issuer and the subject from the verified identity token only. It stores them as
`origin { issuer, subject }` in the payload of every fact of the export, and each consumer copies
them into its `origin_issuer` and `origin_subject` columns. This doc calls one issuer and subject
pair a sender.

## One record becomes one fact

`read` first finds the product that wrote the record. It tries Claude Code, then Codex:

- A Claude Code record has an `event.name` that starts with `claude_code.`, or comes from an
  instrumentation scope whose name starts with `com.anthropic.claude_code`.
- A Codex record has an `event.name` that starts with `codex.`.

The event is the event name without that prefix, such as `api_request`. Each product's file under
`packages/source-telemetry/src/products/` lists the events it knows, and `products.ts` there holds
the list of products.

Every fact goes to the one stream, `facts.telemetry.log_record`. `read` builds each fact from five
parts:

| Part    | Value                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| type    | `telemetry.<product>.<event>` for a listed event; `telemetry.<product>.unlisted` for any other                        |
| session | the `atc.session.id` attribute of the resource, else of the record, else the product's own session attribute          |
| entity  | `telemetry:session:<session>`                                                                                         |
| time    | the record's `event.timestamp` attribute, else its `timeUnixNano`                                                     |
| ID      | `event:telemetry:<product>.<event>:<key>`, where `<event>` is the event without the prefix, for an unlisted event too |

- atc, the tool that runs agent sessions, stamps `atc.session.id` on every record of a session it
  runs. The product's own session attribute is `session.id` for Claude Code and `conversation.id`
  for Codex.
- Ingest's clock never sets a fact's time.
- The key in the ID is the event's own key where the product defines one, such as a request ID.
  Otherwise the key is `h-` and a SHA-256 of the product's own session ID, the event name, the
  record's time, its body and its sorted attributes.
- The hash leaves out the resource and the observed time, because a collector that forwards a record
  may set both again.

`read` drops a record of no known product, a record with no session and a record with no time, and
logs one warning per export with a count for each reason. A dropped record never refuses the rest of
its export.

## The consumers

| Consumer and table        | One row per              | Built from                                                                                    |
| ------------------------- | ------------------------ | --------------------------------------------------------------------------------------------- |
| `telemetry_model_request` | model request            | a Claude Code `api_request` event; a Codex `sse_event` event of the kind `response.completed` |
| `telemetry_turn_cost`     | turn that reports a cost | a Codex `turn_cost` event                                                                     |

Both consumers run in [fact mode](../consumers/host.md#a-fact-mode-batch) on
`facts.telemetry.log_record`. Each takes a row's key from its fact's ID, so the host can apply facts
in any order and get the same rows.

Claude Code reports a cost per request. Codex reports no cost for one request, and an estimate per
turn. Each product's cost therefore lands in exactly one of the two tables, and a sum over both
counts nothing twice.

- The model request consumer writes `cost_basis` to record whether the product reported a cost, and
  leaves a missing cost null, never 0.
- Each consumer skips a record that lacks a model or token counts.
- Nobody has checked either product's wire format against a captured export, so each consumer reads
  a number from a JSON number or from decimal text.

To add a third product, add its file to `products.ts` and its case to each consumer. A consumer
fails to compile until it has the case.

## The query

`telemetry_session_model_requests` returns the model requests of one session, oldest first. The
caller passes:

- the session, by its full ID, `telemetry:session:<id>`;
- the issuer of the sender that runs the session;
- the subject of that sender.

The query returns only the rows whose origin is that sender. A record that carries another sender's
session ID stays in the table, under its true origin, and this filter leaves it out of the result.

Neither ingest nor the plug-in records which sender runs a session. The caller learns it from
outside this plug-in, such as from the facts of the tool that starts the sessions.

## Known limits

- A query that reads the telemetry tables without the origin filter counts records that another
  sender wrote under the session's ID.
- A sender writes the time of each of its records, so it can move its own records to another time.
  It can never write a row under another sender's origin.
- Every session on one machine has the same sender, so a caller can never use the origin to tell two
  sessions on one machine apart.
- A machine that cannot prove its identity cannot send telemetry. While the trust documents or the
  audience are unset, ingest answers 401 to every export, and the exporter drops each one.
- Two copies of one record get one fact ID even when a collector rewrote the resource between them,
  because the ID leaves the resource out. When the rewrite changed `atc.session.id`, the two copies
  name two sessions. Each consumer keeps the first copy it reads from the log and drops the second
  as a repeat, so the row stays under the first copy's session.
- The model request's `agent` column is always null: `read` recognises no attribute from either
  product as the subagent of a request.
- The log keeps every record of a known product, tool and hook events included, though only model
  requests and turn costs become rows.
