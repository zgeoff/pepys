# 0004: Events first, observations as the fallback

Date: 2026-10-22

## Decision

pepys records source changes as events: webhooks, and history APIs such as GitHub timelines and
Gmail's `history.list`. A poll that records an object's full state, an observation, runs for a
source with a history API only after a gap longer than the source keeps that history, and writes
only when the object changed. Consumers and history accept both kinds.

One exception: an object with no history API, such as a Gmail label, is always recorded as
observations of its current state.

## Rejected alternatives

| Option                              | Why not                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------- |
| polling snapshots as the main input | loses every intermediate state between two polls, so status history becomes guesswork |
| webhooks alone                      | GitHub does not retry failed deliveries, so an outage loses changes for good          |

## Why

The owner wants status history, which only events give exactly. Redelivery and history APIs recover
from short outages with events too, so where a history API exists, observations appear only after
long gaps. Where none exists, observations are the only record available. Each transition records
which kind produced it.
