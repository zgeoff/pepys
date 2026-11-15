# mcp-queries

Run this journey on `local`, and check its end state: an agent with no person present calls pepys's
queries as MCP tools at the API's `/mcp`. After a deploy, also run the two reads in
[On prod](#on-prod) against the deployed pepys.

The agent signs in as a service client: it trades the client's ID and secret for an access token at
the API's OAuth server. The `mcp` commands of `bun verify` sign in for you, so you never pass a
token. On `local`, `bun verify up` mints a service client for the run and adds it to the run's API.

- Use the IDs the journey uses. `send-webhook` gives a pull request the GitHub ID 1874433009 plus
  its number, so pull request #52 has the entity ID `github:pull_request:1874433061`.
- Pass a tool's input as a JSON object in `--args`. Each call below shows the fields its tool takes.
- Use the issuer `harbour-broker` and the subject `verify-agent` for the telemetry call: they are
  the sender that `send-telemetry` signs each export as, on every `local` run.
- Check `data.isError` on each call. A tool that fails still gives `ok: true` on the envelope, with
  `data.isError: true` and the reason in `data.content`.
- Expect `inReadTools: true` on each tool. `false` means a tool that the target's `readTools` list
  in [`constants.ts`](../../../../scripts/verify/constants.ts) leaves out, which `prod` refuses to
  call. Report it as a failure of the feature.

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
  `telemetry_session_model_requests` and `logbook_harbour_voyages`.
- `mcp call github_pull_request_delivery` gives `isError: false`, and `structuredContent.result`
  holds one object: `pullRequest` `github:pull_request:1874433061`, `mergedAt`
  `2026-10-08T10:00:00Z`, and `release.tag` `v2.3.0`.
- `mcp call telemetry_session_model_requests` gives `isError: false`, and `structuredContent.result`
  holds one object: `id` `telemetry:model_request:claude_code.api_request:req_channel_01`, `model`
  `model-large`, `input_tokens` 30 and `output_tokens` 120.

## On prod

`prod` is the deployed pepys, and only reads. Run no action and no `caught-up` there. When a read
fails, give its `data` in your reply, and skip `done`.

1. Run `bun verify use --target prod`, then `bun verify use --feature mcp-queries`.
2. Start the run with the secret of the read client `service:wringer-ro`. 1Password keeps the secret
   in the item `pepys verify prod mcp client` of pepys's vault. Set the variable on the `attach`
   command alone, and never print it. `attach` starts the run's supervisor, which keeps the secret
   and signs in for each later `mcp` command.

   ```bash
   PEPYS_PROD_MCP_SECRET="$(op read 'op://pepys/pepys verify prod mcp client/credential')" bun verify attach
   ```

   Expect: `ok: true` and `data.status` `running`.

3. Run `bun verify doctor`. On `prod`, `mcp-door` checks that `/mcp` answers, and `mcp-sign-in`
   checks that the client signs in. The doctor reports each check of the `local` stack as `skipped`
   there.

   Expect: `data.passed: true`. When `mcp-sign-in` fails, check that the deployed service-token file
   holds the client's digest, and that the secret came from the right item.

4. Run the two reads:

   ```bash
   bun verify mcp tools
   bun verify mcp call get_entity --args '{"id":"zgeoff/pepys#229"}'
   ```

   Expect: `server: "pepys"` and six tools, each with `inReadTools: true`: `get_entity`,
   `neighbourhood`, `github_pull_request_delivery`, `telemetry_session_model_requests`,
   `boxxy_cost_to_land` and `boxxy_stage_time`. Then `get_entity` gives `isError: false`, and
   `structuredContent.entity.id` is `github:pull_request:5309377864`. `get_entity` takes an
   `owner/repo#number` alias as well as an entity ID. Pull request #229 is merged, so its entity
   stays in the deployed store.

5. Run `bun verify done`. Expect: `ok: true`. `prod` keeps its evidence in `.wringer/`, since the
   deployed store's data must stay out of a public PR.
6. Run `bun verify detach`, then `bun verify use --target local`. `detach` removes the run's
   `secrets.ndjson`, where the run keeps the secret to scrub it from the evidence.
