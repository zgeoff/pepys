# Spike: Source history retention

Ingest recovers from an outage through GitHub's delivery log and Gmail's history IDs, and each
source keeps that history for a limited time. This spike measures both limits, for the ingest
design's choice of when to resync with observations.

## Question

How long does GitHub keep an App's webhook deliveries for redelivery, and how long does a Gmail
history ID stay valid?

## Answer

- The spike is partial: it read the documentation on 2026-11-04. The Gmail probe stored a history ID
  that day and has measured no expiry, and the GitHub probe waits on a GitHub App credential.
- GitHub documents 3 days: "You can redeliver webhook deliveries that occurred in the past 3 days."
- GitHub never redelivers a failed delivery on its own, so the sweep must run more often than every
  3 days.
- Gmail documents no fixed limit: "A historyId is typically valid for at least a week, but in some
  rare circumstances may be valid for only a few hours."
- An expired Gmail history ID returns HTTP 404, and the documented response is a full sync.

Resync GitHub from observations after an outage longer than 3 days, and resync Gmail on any 404,
whatever the outage length.

## Run it

```bash
PEPYS_GITHUB_CLIENT_ID=<client_id> PEPYS_GITHUB_APP_PRIVATE_KEY_PATH=<pem_path> \
  bun run --filter ./research/source-retention github
bun --env-file=<env_file> research/source-retention/run-gmail-probe.ts
```

The credentials, the daily schedule for the Gmail probe and the versions are in
[Setup](results.md#setup).

## Results

[results.md](results.md) holds the quoted documentation, the method and the check the probes must
pass.

## Untested

The GitHub probe, the redelivery of an old delivery, and a history ID kept past a week:
[Untested](results.md#untested).
