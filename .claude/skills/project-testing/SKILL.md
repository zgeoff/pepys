---
name: project-testing
description:
  pepys's test facts and departures on top of the shared testing skill. They cover where the lanes
  and test helpers live, the Bun e2e lane and its shared slice, consumer tests, and the per-run
  fixtures. Load together with the testing skill when designing, writing, or reviewing pepys tests.
metadata:
  kind: rule-set
---

# pepys testing

## Facts

| Fact       | Where                                                                                                                                                                                                            |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lanes      | Rust: each profile in [`nextest.toml`](../../../.config/nextest.toml), with its test-path filter and `slow-timeout`. Bun: the `test:e2e` script in [`package.json`](../../../package.json), with its `--timeout` |
| Test utils | `src/test-utils/` of the package that owns what the helper starts, builds or fakes, such as [`packages/api/src/test-utils`](../../../packages/api/src/test-utils)                                                |

## Departures

- Put a Bun e2e test in the root `e2e/` folder, in place of the package folder in
  [Package layout](../testing/references/system-tests.md#package-layout). The thin slice drives
  ingest, the host and the API, which three different places build.
- Start what the Bun e2e tests share in [`start-thin-slice.ts`](../../../e2e/start-thin-slice.ts),
  in place of the rig setup hook in
  [Files and shared hosts](../testing/references/system-tests.md#files-and-shared-hosts). pepys has
  no `rig.config.ts`, so the `test:e2e` script preloads the file. The preload starts the slice once
  for the whole lane, and sets the `PEPYS_` variables that each test reads in its `setupTest()`.

## Pure functions

- Test a pure function with plain values, and give it no database, network or temporary directory.

## Consumer tests

A consumer is the pure function that turns a fact into the operations the host applies. Its rules
sit under Consumers in [project-code-style](../project-code-style/SKILL.md).

- Feed the consumer inline facts, written in the test beside the assertion.
- Assert the full returned operation list with `toStrictEqual`, never a single field of one
  operation, so an extra or missing operation fails the test.

## Per-run fixtures

Run a test that needs one of these real systems in the unit run, under its 5 s limit. Each one
starts fast and gives each test its own copy.

| Real system     | Fixture                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| the s2-lite log | s2-lite in memory mode: start it with no `--bucket`                        |
| the Turso store | a Turso database in a temporary file, one per test                         |
| network faults  | `turmoil`, a Rust crate that simulates the network inside the test process |

## Lanes

- Name the module of a Rust lane test after the lane, so its test path starts with `e2e::` or
  `model_api::`. A Rust module name takes no hyphen. The default nextest profile leaves both
  prefixes out.
- Before you run the Bun e2e lane, start Docker and run `bun run test:e2e:prepare`, with
  `PEPYS_ZIG_BIN` and `PEPYS_WASM_TOOLS_BIN` set. It builds the host and the consumers, so run it
  again after you change either.

| Lane        | Real system                                                                  | Run                                     |
| ----------- | ---------------------------------------------------------------------------- | --------------------------------------- |
| `e2e`, Rust | Garage, for crash durability; the Durable Streams conformance tests          | `cargo nextest run --profile e2e`       |
| `e2e`, Bun  | Garage and s2-lite in Docker; ingest, the host and the API, run as processes | `bun run test:e2e`                      |
| `model-api` | hosted models                                                                | `cargo nextest run --profile model-api` |

The `model-api` lane runs nightly and on dispatch, and on a pull request only through an opt-in
label.

Give a test of live GitHub or Gmail a lane of its own, on the `model-api` schedule, with the test
path `github_api::` or `gmail_api::`. Neither is a model API. With the first test of such a lane,
add the lane's profile to `nextest.toml`, and add its prefix to the prefixes the default profile
leaves out.
