---
name: project-testing
description:
  pepys's test facts on top of the shared testing skill: how a consumer test feeds facts and
  asserts operations, which test regime applies, the per-run fixtures, and the lanes. Load together
  with the testing skill when designing, writing, or reviewing pepys tests.
---

# pepys testing

The shared testing skill holds every rule. This skill holds only the facts of pepys that a test
author needs to follow those rules here.

## The regime

The regime is Pure until a package owns a store. Tests of a pure function need no database, no
network, and no temporary directory.

## Consumer tests

- Feed the consumer inline facts, written in the test beside the assertion.
- Assert the full returned operation list with `toStrictEqual`, never a single field of one
  operation, so an extra or missing operation fails the test.

## Per-run fixtures

Each of these real systems starts fast and isolates per test, so a test that needs one runs in the
unit run under the 5 s rule.

| Real system     | Fixture                                                        |
| --------------- | -------------------------------------------------------------- |
| the s2-lite log | s2-lite in memory mode: start it with no `--bucket`            |
| the Turso store | a Turso database in a temporary file, one per test             |
| network faults  | `turmoil`, which simulates the network inside the test process |

## Lanes

A lane test lives in a module named after the lane, so its Rust test path starts with `e2e::` or
`model_api::`, because a Rust module name takes no hyphen. The default nextest profile in
[`nextest.toml`](../../../.config/nextest.toml) leaves both prefixes out and ends any test at 5 s;
each lane runs under its own profile with its own per-test time limit.

| Lane        | Real system                                                         | Run                                     | Limit |
| ----------- | ------------------------------------------------------------------- | --------------------------------------- | ----- |
| `e2e`       | Garage, for crash durability; the Durable Streams conformance tests | `cargo nextest run --profile e2e`       | 15 s  |
| `model-api` | hosted models, and live GitHub and Gmail                            | `cargo nextest run --profile model-api` | 120 s |

The `model-api` lane runs nightly and on dispatch, never on a pull request.
