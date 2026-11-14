# pull-request-delivery

A team reads how far a merged pull request has got with the `github_pull_request_delivery` query:
when it merged, the first release after the merge, and the deploy to an environment. GitHub sends
the facts as webhooks to ingest, the host applies them, and the API answers the query.

The journey sends pull request #31 opened, reviewed and merged, then release `v2.1.0`. The e2e
deployment sends no deploys, and no consumer reads reviews, so the review is sent but shows in no
read.

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
- `query delivery` returns one row in `data`: `pullRequest` `github:pull_request:1874433040`,
  `mergedAt` `2026-10-02T11:00:00Z`, `release` with `tag` `v2.1.0` and `at` `2026-10-03T08:00:00Z`,
  and `deploy` null.
- `db query` returns one row: `number` 31, `state` `closed`, `is_merged` 1 and `merged_at`
  `2026-10-02T11:00:00Z`.
