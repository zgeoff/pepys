# 0023: Contracts follow ports, strategies and champion-challenger

- Date: 2026-11-04
- Status: decided
- Design: [the architecture overview](../architecture/overview.md)

## Decision

pepys declares its contracts by the rules of the
[architecture design](../design/pepys/architecture.md). A contract is a type or a command signature
that one part of pepys declares and another builds against, such as a port, a consumer declaration,
a query or a CLI command.

- **Ports.** The core calls each outside system, such as s2-lite or the Jev API, through a port with
  at least two adapters, a test fake included. A system with one adapter gets no port.
- **Strategies.** Where one processing step has competing implementations, such as two MIME parsers,
  the owner picks one in the deployment code. Each implementation has a version hash.
- **Champion and challenger.** Each consumer and each enrichment job records its champion, the
  version whose output the owner sees. A new version runs as a challenger on the same input as the
  champion, and nobody sees its output until the owner promotes it. An evaluation report scores the
  challenger against data the owner labelled, where such data exists. The architecture design sets
  the input, the score and the promotion step for consumers, enrichment jobs and ranking.
- **Buckets.** A consumer challenger always replays every fact. An enrichment challenger can first
  run on a sample: the scopes, such as Gmail threads, whose hashed ID falls in its buckets.

## Rejected alternatives

| Option                                                  | Why not                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| one generic provider interface for every outside system | it hides the transaction, cursor and durability guarantees that set each system apart                  |
| a port in front of the Turso store                      | Turso is the store's only engine, so the port would have one adapter                                   |
| the link extractors as strategies                       | each extractor finds links that the others miss, so the deployment runs all of them                    |
| the newest enrichment job version is live               | a challenger's output would reach the owner before promotion, and change the corrections that score it |
| a bucket per message                                    | the messages of one thread could run under two job versions                                            |
| live bucketed experiments for consumers or for ranking  | a consumer replay is exact and cheap, and one owner runs too few queries for statistics on ranking     |

## Why

The owner wants coding agents to build pepys behind contracts that are written first. Ports that
report each system's real outcomes, a version hash on every implementation, and one path from
challenger to champion leave an implementer fewer choices that two agents could make differently.
