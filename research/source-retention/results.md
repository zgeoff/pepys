# Source history retention: results

The spike is partial. The documented limits are 3 days for GitHub's delivery log, and no fixed limit
for a Gmail history ID, which Gmail calls "typically valid for at least a week". The two live probes
have runners but have not run, because pepys has no GitHub App credential and no Gmail OAuth
credential yet. The [README](README.md) holds the question and the answer.

## Method

1. Read the current GitHub and Gmail documentation for both limits.
2. List the App's deliveries and note the age of the oldest one returned.
3. Store a Gmail history ID and call `history.list` with it daily until it returns an error.

The spike passes when both limits are known, and the ingest design states which outage length
triggers a resync for each source. Step 1 is done. Steps 2 and 3 wait on the credentials in
[Setup](#setup).

## Documented limits

Each quote is word for word from the page, read on 2026-11-04. The GitHub pages show no update date.

| Source | Quote                                                                                                                                                | Page                                                                                                                              | Page updated |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| GitHub | "You can redeliver webhook deliveries that occurred in the past 3 days."                                                                             | [Redelivering webhooks](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks)           | not shown    |
| GitHub | "You can view details about webhook deliveries that occurred in the past 3 days."                                                                    | [Viewing webhook deliveries](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries) | not shown    |
| GitHub | "GitHub does not automatically redeliver failed deliveries."                                                                                         | [Handling failed webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/handling-failed-webhook-deliveries)       | not shown    |
| Gmail  | "A historyId is typically valid for at least a week, but in some rare circumstances may be valid for only a few hours."                              | [users.history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)                      | 2026-04-15   |
| Gmail  | "Supplying an invalid or out of date startHistoryId typically returns an HTTP 404 error code."                                                       | [users.history.list](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.history/list)                      | 2026-04-15   |
| Gmail  | "If the startHistoryId supplied by your client is outside the available range of history records, the Gmail API returns an HTTP 404 error response." | [Synchronize clients with Gmail](https://developers.google.com/workspace/gmail/api/guides/sync)                                   | 2026-09-15   |
| Gmail  | "In this case, your client must perform a full sync."                                                                                                | [Synchronize clients with Gmail](https://developers.google.com/workspace/gmail/api/guides/sync)                                   | 2026-09-15   |

The GitHub pages give the same 3 days for repository, organization and GitHub App webhooks. The
[REST endpoint](https://docs.github.com/en/rest/apps/webhooks) that lists an App's deliveries takes
a JWT signed with the App's private key, and "does not work with GitHub App user access tokens,
GitHub App installation access tokens, or fine-grained personal access tokens". It pages with a
`cursor` and at most 100 deliveries per page.

GitHub's own example script for an App webhook redelivers failed deliveries from a workflow that
"runs every 6 hours", on the
[Automatically redelivering failed deliveries for a GitHub App webhook](https://docs.github.com/en/webhooks/using-webhooks/automatically-redelivering-failed-deliveries-for-a-github-app-webhook)
page.

## What the limits mean for ingest

- A GitHub outage longer than 3 days loses deliveries that no sweep can redeliver, so ingest polls
  the affected objects once and writes observations.
- The redelivery sweep must run well inside 3 days. A failure found on day 3 has hours left.
- Gmail gives no outage length that is safe. A history ID can expire after a few hours, so ingest
  runs a full sync on the 404, whatever the outage length.
- A Gmail poller that runs at least once a day stays inside the "at least a week" of the typical
  case.

## Setup

The runners use zod 4.6.7, `@types/bun` 1.4.4 and Bun 1.4.3, with `fetch` for every call. Neither
runner has run against a live service. Each runner prints counts and times only: the GitHub runner
prints no repository, event or delivery GUID, and the Gmail runner keeps only the HTTP status of
each `history.list` call, never a message ID.

### GitHub delivery log

1. Create the pepys GitHub App with its webhook on, install it, and let it receive deliveries for at
   least 4 days, so the log can hold more than 3 days.
2. Generate a private key for the App and save the `.pem` file outside the repo.
3. From the repo root, run the probe:

   ```bash
   PEPYS_GITHUB_APP_ID=<app_id> PEPYS_GITHUB_APP_PRIVATE_KEY_PATH=<pem_path> \
     bun run --filter ./research/source-retention github
   ```

   Expect: JSON with `deliveryCount`, `failedCount`, `oldestDeliveredAt` and `oldestAgeHours`.

`<app_id>` is the App ID on the App's settings page, and `<pem_path>` is the absolute path of the
key. The step passes when `oldestAgeHours` is 72 or a little less, while the App has received
deliveries for more than 4 days. A larger value means GitHub keeps more than it documents.

### Gmail history ID

1. In a Google Cloud project, enable the Gmail API.
2. Set the OAuth consent screen's publishing status to "In production". Google issues an app in
   "Testing" "a refresh token expiring in 7 days", by its
   [OAuth 2.0 page](https://developers.google.com/identity/protocols/oauth2) read on 2026-11-04, and
   that token ends the probe before it measures a week.
3. Create an OAuth client, and get a refresh token for the owner's account with the one scope
   `https://www.googleapis.com/auth/gmail.metadata`.
4. Write an env file outside the repo, readable only by the owner (`chmod 600`):

   ```bash
   PEPYS_GMAIL_CLIENT_ID=<client_id>
   PEPYS_GMAIL_CLIENT_SECRET=<client_secret>
   PEPYS_GMAIL_REFRESH_TOKEN=<refresh_token>
   PEPYS_SPIKE_STATE_PATH=<state_path>
   ```

   `<state_path>` is a JSON file outside the repo, such as
   `/home/<user>/.local/state/pepys-spike/gmail-history.json`. Its folder must exist. Write the path
   in full, because Bun keeps a `~` in an env file as a literal character.

5. Run the probe once. The first run stores the mailbox's current history ID and its time:

   ```bash
   bun --env-file=<env_file> research/source-retention/run-gmail-probe.ts
   ```

   Expect: JSON with `probeCount: 0`.

6. Add a daily crontab line, with `<repo>` as the absolute path of the checkout:

   ```bash
   0 9 * * * cd <repo> && ~/.bun/bin/bun --env-file=<env_file> research/source-retention/run-gmail-probe.ts >> ~/.local/state/pepys-spike/gmail-probe.log 2>&1
   ```

Each later run calls `history.list` once with the stored ID and adds the HTTP status to the state
file. The runner throws on any status other than 200 or 404, such as a 401 from a revoked token, so
an auth fault never reads as an expiry. Once a run gets a 404, every later run prints the verdict
and calls nothing. The verdict gives `lastValidAgeHours` and `firstExpiredAgeHours`, and the history
ID's lifetime lies between the two. Remove the crontab line after the first 404, or after 4 weeks
with none, which gives a lower bound.

## Untested

- The GitHub probe: the age of the oldest delivery the App's log returns.
- A redelivery of a delivery close to 3 days old, which the listing alone does not show.
- The Gmail probe: the age at which a stored history ID returns 404.
- Whether a mailbox with more or less activity keeps a history ID for a different time.
- A Workspace account, whose history may differ from a personal Gmail account.
- Both runners end to end: no call has reached GitHub or Gmail with a real credential.
