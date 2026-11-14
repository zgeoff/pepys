# session-model-requests

A coding agent's harness sends its OpenTelemetry logs to ingest's `/v1/logs` route. Each request
carries a bearer token, and an identity token that an identity issuer signed for one subject. The
`telemetry_session_model_requests` query, which `query session-requests` calls, lists the model
requests of one session that a given issuer and subject sent. Requests from another sender stay out
of the list.

- `send-telemetry` takes the bare session name, `s-reef`, and returns the session's entity ID,
  `telemetry:session:s-reef`. `query session-requests` takes the entity ID.
- `send-telemetry` signs each export with the `local` run's own issuer, `harbour-broker`, for the
  subject `verify-agent`. Neither has a flag. Query with those two names.
- A request that leaves out `cacheReadTokens` stores 0. One that leaves out `costUsd` stores null:
  no cost was reported.

## Journey

```bash
bun verify use --feature session-model-requests
bun verify action send-telemetry --session s-reef --requests '[{"id":"req_reef_01","model":"model-large","inputTokens":12,"outputTokens":210,"cacheReadTokens":900,"costUsd":0.4,"at":"2026-11-11T02:20:00.000Z"},{"id":"req_reef_02","model":"model-small","inputTokens":40,"outputTokens":15,"at":"2026-11-11T02:30:00.000Z"}]'
bun verify caught-up
bun verify query session-requests --session telemetry:session:s-reef --issuer harbour-broker --subject verify-agent
```

## End state

- `send-telemetry` returns `data.session` `telemetry:session:s-reef`.
- `query session-requests` returns an array of two objects in `data`, oldest first:
  - `id` `telemetry:model_request:claude_code.api_request:req_reef_01`, `model` `model-large`,
    `input_tokens` 12, `output_tokens` 210, `cache_read_tokens` 900 and `cost_usd` 0.4;
  - `id` `telemetry:model_request:claude_code.api_request:req_reef_02`, `model` `model-small`,
    `input_tokens` 40, `output_tokens` 15, `cache_read_tokens` 0 and `cost_usd` null.
