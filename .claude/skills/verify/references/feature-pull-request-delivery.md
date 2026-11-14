# pull-request-delivery

An API client calls the `github_pull_request_delivery` query to see a merged pull request's merge
time, the first release after the merge, and that release's deploy to an environment. The CLI's
`query delivery` command calls it through the API. The journey sends GitHub webhooks to ingest, the
service that stores each one as a fact. The host applies the facts, and the API answers the query.

- Use the IDs the journey uses. `send-webhook` gives a pull request the GitHub ID 1874433009 + its
  number, so pull request #31 has the entity ID `github:pull_request:1874433040`.
- Expect `deploy` null. The journey sends no deploy webhook.
- Expect no read to show the review. A real pull request gets one, so the journey sends one, and
  checks only that `send-webhook` returns `data.sent` 1. The e2e deployment has no consumer of
  reviews.
- Compare each time as the same instant. A time may come back with milliseconds, such as
  `2026-10-02T11:00:00.000Z`.

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
- `query delivery` returns an array of exactly one object in `data`, with at least these fields:
  - `pullRequest`: `github:pull_request:1874433040`;
  - `mergedAt`: 2026-10-02 11:00:00 UTC;
  - `release`: `tag` `v2.1.0`, and `at` 2026-10-03 08:00:00 UTC;
  - `deploy`: null.
- `db query` returns one row in `data.rows`: `number` 31, `state` `closed`, `is_merged` 1, and
  `merged_at` 2026-10-02 11:00:00 UTC.
