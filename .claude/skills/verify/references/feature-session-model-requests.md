# session-model-requests

A coding agent's harness sends its OpenTelemetry logs to ingest's `/v1/logs`, with a bearer token
and an identity token that proves who sent them. The `telemetry_session_model_requests` query lists
the model requests of one session, for the sender that proved it.

The journey sends one logs export of session `s-reef` with two model requests, signed by the run's
identity issuer, `harbour-broker`, for the subject `imp-verify`.

## Journey

```bash
bun verify use --feature session-model-requests
bun verify action send-telemetry --session s-reef --requests '[{"id":"req_reef_01","model":"model-large","inputTokens":12,"outputTokens":210,"cacheReadTokens":900,"costUsd":0.4,"at":"2026-11-11T02:20:00.000Z"},{"id":"req_reef_02","model":"model-small","inputTokens":40,"outputTokens":15,"at":"2026-11-11T02:30:00.000Z"}]'
bun verify caught-up
bun verify query session-requests --session telemetry:session:s-reef --issuer harbour-broker --subject imp-verify
```

## End state

- `send-telemetry` returns `data.session` `telemetry:session:s-reef`.
- `query session-requests` returns two rows in `data`, oldest first:
  - `id` ending `req_reef_01`, `model` `model-large`, `input_tokens` 12, `output_tokens` 210,
    `cache_read_tokens` 900 and `cost_usd` 0.4;
  - `id` ending `req_reef_02`, `model` `model-small`, `input_tokens` 40, `output_tokens` 15,
    `cache_read_tokens` 0 and `cost_usd` null.
