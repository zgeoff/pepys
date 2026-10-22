# 0018: Deploys run as preview and up

Date: 2026-10-22

## Decision

`pepys preview` builds a consumer version, replays into a throwaway file and shows the diff, for
development. `pepys up` replays into a new file, swaps it in and asks nothing. The previous file
stays for rollback.

## Rejected alternatives

| Option                                  | Why not                                               |
| --------------------------------------- | ----------------------------------------------------- |
| a shadow replay that waits for approval | a deploy outside development would stall on a person  |
| replaying in place                      | readers would see half-empty tables during the replay |

## Why

The diff matters during development, and a deploy should act at once. Building the new file to the
side keeps readers on the old version until one atomic swap.
