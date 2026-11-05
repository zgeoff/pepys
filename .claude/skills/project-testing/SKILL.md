---
name: project-testing
description:
  pepys's test facts and departures on top of the shared testing skill. They cover where the lanes
  and test helpers live, the Bun e2e lane and the thin slice it runs, consumer tests, and the
  per-run fixtures. Load together with the testing skill when designing, writing, or reviewing pepys
  tests.
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

The thin slice is the end-to-end path of one fact: a signed GitHub webhook into ingest, the host
that applies it to a Turso file, and the API that serves the row.

- Put a Bun e2e test in the root `e2e/` folder, in place of the package folder in
  [Package layout](../testing/references/system-tests.md#package-layout). No one package builds the
  slice: ingest is in `packages/source-github`, the host in `crates/host`, the API in
  `packages/api`.
- Start each process and each piece of data that more than one e2e test reads in
  [`start-stack.ts`](../../../e2e/start-stack.ts). It replaces the rig setup hook in
  [Files and shared hosts](../testing/references/system-tests.md#files-and-shared-hosts), since
  pepys does not use the rig test runner. The `test:e2e` script preloads the file, and the file sets
  the `PEPYS_` variables that each test reads in its `setupTest()`.
- Start a process that only one e2e test needs in that test's `setupTest()`.

## Pure functions

- Test a pure function with plain values, and give it no database, network or temporary directory.

## Consumer tests

- Feed a consumer inline facts, written in the test beside the assertion. The Consumers section of
  [project-code-style](../project-code-style/SKILL.md) defines a consumer.
- Assert the full returned operation list with `toStrictEqual`, never a single field of one
  operation, so an extra or missing operation fails the test.

## Per-run fixtures

Keep a test that needs one of these in the unit run: `bun test`, or the default nextest profile.
Each fixture starts fast and gives each test its own copy, so the test stays under the 5 s unit
limit.

| The test needs  | Fixture                                                                    |
| --------------- | -------------------------------------------------------------------------- |
| the s2-lite log | s2-lite in memory mode: start it with no `--bucket`                        |
| the Turso store | a Turso database in a temporary file, one per test                         |
| network faults  | `turmoil`, a Rust crate that simulates the network inside the test process |

## Lanes

- Name the module of a Rust test in a lane after the lane, so its test path starts with `e2e::` or
  `model_api::`. A Rust module name takes no hyphen. The default nextest profile leaves both
  prefixes out.
- Start Docker before you run the Bun e2e lane.
- Set `PEPYS_ZIG_BIN` and `PEPYS_WASM_TOOLS_BIN`, then run `bun run test:e2e:prepare`. It builds the
  host and the consumers. Run it again after you change either. Ingest and the API run from source.

| Lane        | Real system                                                                  | Run                                     |
| ----------- | ---------------------------------------------------------------------------- | --------------------------------------- |
| `e2e`, Rust | Garage, for crash durability; the Durable Streams conformance tests          | `cargo nextest run --profile e2e`       |
| `e2e`, Bun  | Garage and s2-lite in Docker; ingest, the host and the API, run as processes | `bun run test:e2e`                      |
| `model-api` | hosted models                                                                | `cargo nextest run --profile model-api` |

The `model-api` lane runs nightly and on dispatch, and on a pull request only through an opt-in
label.

Give a test of live GitHub or Gmail a lane of its own, on the `model-api` schedule, with the test
path `github_api::` or `gmail_api::`. Neither is a model API. With the first test of such a lane:

1. Add the lane's profile to `nextest.toml`.
2. Add the lane's prefix to the prefixes the default profile leaves out.
