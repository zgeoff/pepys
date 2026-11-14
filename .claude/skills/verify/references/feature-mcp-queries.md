# mcp-queries

An agent with no person present calls pepys's queries as MCP tools at the API's `/mcp`. It signs in
as a service client: it trades the client's ID and secret for an access token at the API's OAuth
server. The `mcp` commands of `bun verify` sign in for you, so no command names a token. On `local`,
`bun verify up` mints a client for the run, and the run's API serves it.

- Use the IDs the journey uses. `send-webhook` gives a pull request the GitHub ID 1874433009 plus
  its number, so pull request #52 has the entity ID `github:pull_request:1874433061`.
- Pass a tool's input as a JSON object in `--args`, with the fields of the matching `query` command.
  `github_pull_request_delivery` takes a list of pull requests, where `query delivery` takes one.
- Use the issuer `harbour-broker` and the subject `verify-agent` for the telemetry call: they are
  the sender that `send-telemetry` signs each export as, on every `local` run.
- Check `data.isError` on each call. A tool that fails still gives `ok: true` on the envelope, with
  `data.isError: true` and the reason in `data.content`.
- Expect `inReadTools: true` on each tool. The registry lists every pepys tool as a read, since none
  writes. A tool with `false` is one the registry leaves out, and `prod`, which only reads, refuses
  to call it. Add the tool to the target's list in the registry.

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

- `mcp tools` gives `server: "pepys"` and exactly these five tools, in any order, each with
  `inReadTools: true`: `get_entity`, `neighbourhood`, `github_pull_request_delivery`,
  `telemetry_session_model_requests` and `logbook_harbour_voyages`. These are the tools of the e2e
  deployment's plug-ins.
- `mcp call github_pull_request_delivery` gives `isError: false`, and `structuredContent.result`
  holds one object: `pullRequest` `github:pull_request:1874433061`, `mergedAt`
  `2026-10-08T10:00:00Z`, and `release.tag` `v2.3.0`.
- `mcp call telemetry_session_model_requests` gives `isError: false`, and `structuredContent.result`
  holds one object: `id` `telemetry:model_request:claude_code.api_request:req_channel_01`, `model`
  `model-large`, `input_tokens` 30 and `output_tokens` 120.

## On prod

Run only the two reads below on `prod`, the deployed pepys. The target refuses every action, so send
no webhook or telemetry, and skip `caught-up`. Treat the run as a smoke check after a deploy, and
record no verdict there: `done` counts on `local`.

1. Run `bun verify use --target prod`, then `bun verify use --feature mcp-queries`.
2. Attach with the read client's secret, `service:wringer-ro`, from pepys's 1Password vault. The
   `mcp` commands read the secret from `attach`'s process, so set it there alone, and never print
   it:

   ```bash
   PEPYS_PROD_MCP_SECRET="$(op read 'op://pepys/pepys verify prod mcp client/credential')" bun verify attach
   ```

3. Run the two reads:

   ```bash
   bun verify mcp tools
   bun verify mcp call get_entity --args '{"id":"zgeoff/pepys#229"}'
   ```

   Expect six tools, each with `inReadTools: true`: the first four tools of `local`, plus
   `boxxy_cost_to_land` and `boxxy_stage_time` from the deployment's boxxy plug-in, and no
   `logbook_harbour_voyages`. Expect `get_entity` to give `isError: false` and an `entity.id` of the
   form `github:pull_request:<number>`. `get_entity` takes an entity ID or an `owner/repo#number`
   alias, and the alias picks a public pull request that stays.

4. Run `bun verify detach`. Expect `data.run`, the run's ID.
5. Remove the run's copy of the secret: wringer keeps each secret a run handles in the run's
   `secrets.ndjson`, to scrub it from the evidence, and leaves the file after `detach`.

   ```bash
   rm .wringer/runs/<run>/secrets.ndjson
   ```
