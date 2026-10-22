# 0003: One stream per fact family

Date: 2026-10-22

## Decision

Each stream holds the facts that one entity consumer projects, such as every pull request webhook
and every pull request timeline event. Poller cursors get their own stream, and manual facts get
theirs.

## Rejected alternatives

| Option                                                     | Why not                                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| one stream per source                                      | every consumer of a source reads every fact of that source                                              |
| one stream per entity                                      | consumers would discover and tail thousands of streams, and new entities would add streams continuously |
| resuming each poller from the last record of a fact stream | one poller writes several streams, and a backfill and a live poller share one                           |

## Why

One stream per family gives each entity consumer exactly one input that it can replay alone. One
entity's history is a query over the fact index, so per-entity streams buy nothing. A separate
cursor stream, written after the facts, makes a crash cost a repeated poll, and deterministic fact
IDs make the repeat harmless.
