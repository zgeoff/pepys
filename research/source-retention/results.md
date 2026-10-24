# Source history retention: results

The spike has not run. This file holds its method and the check it must pass, and the
[README](README.md) holds the question. The two limits decide how long the server can be down before
ingest must resync with observations.

## Method

1. Read the current GitHub and Gmail documentation for both limits.
2. List the App's deliveries and note the age of the oldest one returned.
3. Store a Gmail history ID and call `history.list` with it daily until it returns an error.

The spike passes when both limits are known, and the ingest design states which outage length
triggers a resync for each source.

## Setup

The spike has no runner yet, and its `package.json` pins no version.

## Untested

Every step of the method, until the spike runs.
