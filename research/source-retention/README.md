# Source history retention

Ingest recovers from an outage through GitHub's delivery log and Gmail's history IDs. Each source
keeps that history for a limited time, and the limit decides how long the server can be down before
ingest must resync with observations.

## Question

How long does GitHub keep an App's webhook deliveries for redelivery, and how long does a Gmail
history ID stay valid?

## Method

1. Read the current GitHub and Gmail documentation for both limits.
2. List the App's deliveries and note the age of the oldest one returned.
3. Store a Gmail history ID and call `history.list` with it daily until it returns an error.

## Passes when

Both limits are known, and the ingest design states which outage length triggers a resync for each
source.

## Run

The spike has no runner yet.

## Result

The spike has not run.

## Untested

Every step of the method, until the spike runs.
