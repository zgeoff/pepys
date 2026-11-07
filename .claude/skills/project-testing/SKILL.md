---
name: project-testing
description:
  pepys's test facts and departures on top of the shared testing skill. They cover where the lanes
  and test helpers live, the Bun e2e lane and the GitHub pull request path it runs, consumer tests,
  and the per-run fixtures. Load together with the testing skill when designing, writing, or
  reviewing pepys tests.
metadata:
  kind: rule-set
---

# pepys testing

## Facts

| Fact       | Where                                                                                                                                                                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Lanes      | Rust: each profile in [`nextest.toml`](../../../.config/nextest.toml), with its test-path filter and `slow-timeout`. Bun: [`rig.config.ts`](../../../rig.config.ts), which declares none, and the `test:e2e` script in [`package.json`](../../../package.json), with its `--timeout` |
| Test utils | `src/test-utils/` of the package that owns what the helper starts, builds or fakes, such as [`packages/api/src/test-utils`](../../../packages/api/src/test-utils)                                                                                                                    |

## Departures

The GitHub pull request path is the end-to-end path of one fact: a signed GitHub webhook into
ingest, the host that applies it to a Turso file, and the API that serves the row.

- Put a Bun e2e test in the root `e2e/` folder, in place of the package folder in
  [Package layout](../testing/references/system-tests.md#package-layout). No one package builds the
  path: ingest is in `packages/source-github`, the host in `crates/host`, the API in `packages/api`.
- Start each process and each piece of data that more than one e2e test reads in
  [`start-stack.ts`](../../../e2e/start-stack.ts). It replaces the rig setup hook in
  [Files and shared hosts](../testing/references/system-tests.md#files-and-shared-hosts). rig runs
  the unit tests, but its e2e lane looks for an `e2e/` folder only in a package that has no
  workspaces, and the root `package.json` has them. The `test:e2e` script preloads the file, and the
  file sets the `PEPYS_` variables that each test reads in its `setupTest()`.
- Start a process that only one e2e test needs in that test's `setupTest()`.

## Pure functions

- Test a pure function with plain values, and give it no database, network or temporary directory.

## Consumer tests

- Feed a consumer inline facts, written in the test beside the assertion. The Consumers section of
  [project-code-style](../project-code-style/SKILL.md) defines a consumer.
- Assert the full returned operation list with `toStrictEqual`, never a single field of one
  operation, so an extra or missing operation fails the test.

## Per-run fixtures

Keep a test that needs one of these in the unit run: `bun run test`, or the default nextest profile.
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

To run the Bun e2e lane:

1. Start Docker.
2. Set `PEPYS_ZIG_BIN` and `PEPYS_WASM_TOOLS_BIN` to the paths of the zig and wasm-tools binaries,
   at the versions the Commands section of [AGENTS.md](../../../AGENTS.md) pins.
3. Run `bun run test:e2e:prepare`. It builds the host and the consumers. Run it again after you
   change either. Ingest and the API run from source.
4. Run `bun run test:e2e`.

| Lane        | Real system                                                                  | Run                                     |
| ----------- | ---------------------------------------------------------------------------- | --------------------------------------- |
| `e2e`, Rust | Garage, for crash durability; the Durable Streams conformance tests          | `cargo nextest run --profile e2e`       |
| `e2e`, Bun  | Garage and s2-lite in Docker; ingest, the host and the API, run as processes | `bun run test:e2e`                      |
| `model-api` | hosted models                                                                | `cargo nextest run --profile model-api` |

[`model-api.yml`](../../../.github/workflows/model-api.yml) runs the `model-api` lane nightly, on
`workflow_dispatch`, and on a pull request that changes a release of
`@anthropic-ai/claude-agent-sdk` in `bun.lock`. A new SDK release can change the requests that reach
the models. A pull request that leaves those releases as they are skips the lane.

To run a new `model_api::` test before merge, dispatch the workflow on your branch:
`gh workflow run model-api.yml --ref <your-branch>`.

Give live GitHub tests one lane and live Gmail tests another, with the test path `github_api::` or
`gmail_api::`. They call no model, so keep them out of the `model-api` lane. With the first test of
such a lane:

1. Add the lane's profile to `nextest.toml`, named after the lane, with the `model-api` profile's
   `slow-timeout`.
2. Add the lane's prefix to the prefixes the default profile leaves out.
3. Add a row for the lane to the table above.
4. Add a workflow for the lane, in the shape of `model-api.yml`, that runs nightly and on
   `workflow_dispatch`.
