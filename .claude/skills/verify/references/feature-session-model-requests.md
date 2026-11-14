# session-model-requests

A coding agent's harness sends its OpenTelemetry logs to ingest's `/v1/logs` route. An identity
issuer signs a token for the harness's subject, and the harness sends it with each export. An API
client calls the `telemetry_session_model_requests` query, through the CLI's
`query session-requests`, to list the model requests of one session that one issuer and subject
sent.

- Query with the session's entity ID. `send-telemetry` takes the bare name, `s-reef`, and returns
  the entity ID, `telemetry:session:s-reef`.
- Query with the issuer `harbour-broker` and the subject `verify-agent`. `send-telemetry` takes
  neither as a flag: it signs each export with the `local` run's own issuer for that subject, and
  adds the route's bearer token itself.
- Expect `cache_read_tokens` 0 and `cost_usd` null for a request sent with neither. The consumer
  stores a missing token count as 0, and a missing cost as null, since no cost was reported.
- Expect two requests on a second run too. The consumer keeps one row per request ID.
- Each request's entity ID holds `claude_code.api_request`, the event that Claude Code logs for a
  model request, which `send-telemetry` sends.

## Journey

```bash
bun verify use --feature session-model-requests
bun verify action send-telemetry --session s-reef --requests '[{"id":"req_reef_01","model":"model-large","inputTokens":12,"outputTokens":210,"cacheReadTokens":900,"costUsd":0.4,"at":"2026-11-11T02:20:00.000Z"},{"id":"req_reef_02","model":"model-small","inputTokens":40,"outputTokens":15,"at":"2026-11-11T02:30:00.000Z"}]'
bun verify caught-up
bun verify query session-requests --session telemetry:session:s-reef --issuer harbour-broker --subject verify-agent
```

## End state

- `send-telemetry` returns `data.session` `telemetry:session:s-reef`.
- `query session-requests` returns an array of exactly two objects in `data`, oldest first, with at
  least these fields:
  - `id` `telemetry:model_request:claude_code.api_request:req_reef_01`, `model` `model-large`,
    `input_tokens` 12, `output_tokens` 210, `cache_read_tokens` 900 and `cost_usd` 0.4;
  - `id` `telemetry:model_request:claude_code.api_request:req_reef_02`, `model` `model-small`,
    `input_tokens` 40, `output_tokens` 15, `cache_read_tokens` 0 and `cost_usd` null.
