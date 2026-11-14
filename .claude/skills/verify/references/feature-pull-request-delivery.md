# pull-request-delivery

The `github_pull_request_delivery` query, which `query delivery` calls, gives a merged pull
request's merge time, the first release after the merge, and the deploy of that release to an
environment. The journey sends GitHub webhooks to ingest, the service that receives them. The host
applies them, and the API answers the query.

- `send-webhook` builds a pull request with the GitHub ID 1874433009 plus its number, so #31 is
  `github:pull_request:1874433040`. Every pull request is in the repo `Acme/Harbour`.
- The journey sends #31 opened, then reviewed, then merged, then the release `v2.1.0`. It sends no
  deploy, so `deploy` is null in any environment.
- The journey sends the review because a GitHub delivery holds one, but no consumer in the e2e
  deployment reads reviews. Only `data.sent` shows that ingest took it.

## Journey

```bash
bun verify use --feature pull-request-delivery
bun verify action send-webhook --event opened --number 31 --title 'Light the breakwater' --at 2026-10-02T08:00:00Z
bun verify action send-webhook --event reviewed --number 31 --at 2026-10-02T09:30:00Z
bun verify action send-webhook --event merged --number 31 --title 'Light the breakwater' --at 2026-10-02T11:00:00Z
bun verify action send-webhook --event released --tag v2.1.0 --at 2026-10-03T08:00:00Z
bun verify caught-up
bun verify query delivery --pull-request github:pull_request:1874433040 --environment production
bun verify db query "select number, state, is_merged, merged_at from github_pull_request where number = 31"
```

## End state

- Each `send-webhook` returns `data.sent` 1.
- `query delivery` returns an array of one object in `data`, with the times as written here:
  - `pullRequest`: `github:pull_request:1874433040`;
  - `mergedAt`: `2026-10-02T11:00:00Z`;
  - `release`: `tag` `v2.1.0` and `at` `2026-10-03T08:00:00Z`;
  - `deploy`: null.
- `db query` returns one row in `data.rows`: `number` 31, `state` `closed`, `is_merged` 1 and
  `merged_at` `2026-10-02T11:00:00Z`.
