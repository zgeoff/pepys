# mcp-queries

An agent with no person present reaches the API's `/mcp` as a service client: it trades the client's
ID and secret for an access token, then calls each query as an MCP tool. The `mcp` driver signs in
for you, so the journey never names a token. On `local`, `up` mints the run's own client, and every
tool the e2e deployment serves is a read.

- Use the IDs the journey uses. `send-webhook` gives a pull request the GitHub ID 1874433009 + its
  number, so pull request #52 has the entity ID `github:pull_request:1874433061`.
- Pass a tool's input as a JSON object in `--args`. The tool takes the same fields as the query's
  CLI command, such as `query delivery`, with a pull request list in place of one pull request.
- Expect `isError: false` on each call. A tool that fails still returns `ok: true`, with
  `isError: true` and the reason in `content`.

## Journey

```bash
bun verify use --feature mcp-queries
bun verify action send-webhook --event opened --number 52 --title 'Sound the channel' --at 2026-10-08T08:00:00Z
bun verify action send-webhook --event merged --number 52 --title 'Sound the channel' --at 2026-10-08T10:00:00Z
bun verify action send-webhook --event released --tag v2.3.0 --at 2026-10-09T08:00:00Z
bun verify action send-telemetry --session s-channel --requests '[{"id":"req_channel_01","model":"model-large","inputTokens":30,"outputTokens":120,"at":"2026-11-12T03:00:00.000Z"}]'
bun verify caught-up
bun verify mcp tools
bun verify mcp call github_pull_request_delivery --args '{"pullRequests":["github:pull_request:1874433061"],"environment":"production"}'
bun verify mcp call telemetry_session_model_requests --args '{"session":"telemetry:session:s-channel","issuer":"harbour-broker","subject":"verify-agent"}'
```

## End state

Each field below sits under `data`.

- `mcp tools` returns `server: "pepys"` and five tools, each with `inReadTools: true`: `get_entity`,
  `neighbourhood`, `github_pull_request_delivery`, `telemetry_session_model_requests` and
  `logbook_harbour_voyages`.
- `mcp call github_pull_request_delivery` returns `isError: false`, and `structuredContent.result`
  holds one object with `pullRequest` `github:pull_request:1874433061`, `mergedAt` 2026-10-08
  10:00:00 UTC, and `release.tag` `v2.3.0`.
- `mcp call telemetry_session_model_requests` returns `isError: false`, and
  `structuredContent.result` holds one object with `id`
  `telemetry:model_request:claude_code.api_request:req_channel_01`, `model` `model-large`,
  `input_tokens` 30 and `output_tokens` 120.

## On prod

`prod` is the deployed pepys, which only reads. The `mcp` driver signs in there as the read client
`service:wringer-ro`, with the secret in `PEPYS_PROD_MCP_SECRET`. Set the variable from the item
`pepys verify prod mcp client` in pepys's 1Password vault, in the shell that runs `attach`, and
never print it:

```bash
PEPYS_PROD_MCP_SECRET="$(op read 'op://pepys/pepys verify prod mcp client/credential')" bun verify attach
```

The journey sends nothing on `prod`, so run only these two reads after `use --feature mcp-queries`:

```bash
bun verify mcp tools
bun verify mcp call get_entity --args '{"id":"zgeoff/pepys#229"}'
```

Expect six tools, each with `inReadTools: true`, and `get_entity` to return the public pull request
`zgeoff/pepys#229` with `isError: false`.
