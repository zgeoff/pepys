---
name: project-testing
description:
  pepys's test facts and departures on top of the shared testing skill. They cover where the lanes
  and test helpers live, the Bun e2e lane and the GitHub pull request path it runs, consumer tests,
  the per-run fixtures, and the Rust e2e, model-api and live-API lanes. Load together with the
  testing skill when designing, writing, or reviewing pepys tests.
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

- Put a test that needs s2-lite or Garage in the `e2e` lane of its language, in place of a
  `<name>.docker.test.ts` file in the `docker` lane of
  [Lanes](../testing/references/slow-tests.md#lanes). pepys runs no `docker` lane. The unit run
  can't hold these tests either: on a machine without the s2-lite image, a pull of the image and a
  start of s2-lite took 7.9 s, past the 5 s unit limit.

The bullets below apply to the Bun e2e lane only. Besides the adapter fixtures, it runs the GitHub
pull request path, the end-to-end path of one fact: a signed GitHub webhook into ingest, the host
that applies it to a Turso file, and the API that serves the row.

- Put a Bun e2e test in the root `e2e/` folder, in place of the package folder in
  [Package layout](../testing/references/system-tests.md#package-layout). No one package builds the
  path: ingest is in `packages/source-github`, the host in `crates/host`, the API in `packages/api`.
- When more than one e2e test needs a process or seeded data, start or seed it in
  [`start-stack.ts`](../../../e2e/start-stack.ts), in place of the rig setup hook in
  [Files and shared hosts](../testing/references/system-tests.md#files-and-shared-hosts).
  `bun run test:e2e` runs the `e2e/` folder with plain `bun test` and preloads `start-stack.ts`. The
  `@zgeoff/rig` test runner runs only the unit tests here, and declares no lane in
  [`rig.config.ts`](../../../rig.config.ts): its e2e lane never finds an `e2e/` folder at the root
  of a repo with workspaces, as pepys is.
- Read the stack's addresses in each test's `setupTest()`, from the `PEPYS_` variables that
  `start-stack.ts` sets.

## Pure functions

- Test a pure function with plain values, and give it no database, network or temporary directory.

## Consumer tests

- Feed a consumer inline facts, written in the test beside the assertion. The Consumers section of
  [project-code-style](../project-code-style/SKILL.md) defines a consumer.
- Assert the full returned operation list with `toStrictEqual`, never a single field of one
  operation, so an extra or missing operation fails the test.

## Per-run fixtures

Keep a test in the unit run when the only real system it needs is in the list below, and give each
test its own copy of that system. Each starts fast enough to keep a test under the 5 s unit limit:
the `slow-timeout` of the default profile in [`nextest.toml`](../../../.config/nextest.toml) for
Rust, and Bun's default test timeout for `bun run test`.

- For the Turso store, give the test a Turso database in a temporary file.
- For a network fault in a Rust test, run the test on `turmoil`, a crate that simulates the network
  inside the test process.

## Lanes

- Name the module of a Rust test in a lane after the lane, so its test path starts with `e2e::` or
  `model_api::`. A Rust module name takes no hyphen. The host's `e2e` tests live in
  [`crates/host/src/e2e.rs`](../../../crates/host/src/e2e.rs).
- Read the shared fixture files of a port from `packages/ingest/src/<port>/fixtures/`, in both
  languages. `<port>` is `fact-log` or `blob-store`, the ports that the Folders section of
  [project-code-style](../project-code-style/SKILL.md) defines. Each fixture file then runs against
  the adapters of both languages. The fact envelope cases in
  [`fact-envelope-cases.json`](../../../packages/schema/src/fact-envelope-cases.json) work the same
  way, in the unit run.
- Give each s2-lite test, in either language, a basin, the S2 namespace that holds streams, under a
  name no other test in the run uses, such as `conformance-<fixture file name>` in
  [`e2e.rs`](../../../crates/host/src/e2e.rs).

To run the Bun e2e lane:

1. Start Docker.
2. Set `PEPYS_ZIG_BIN` and `PEPYS_WASM_TOOLS_BIN` to the paths of the zig and wasm-tools binaries,
   at the versions the Commands section of [AGENTS.md](../../../AGENTS.md) pins.
3. Run `bun run test:e2e:prepare`. It builds the host and the consumers. Run it again after you
   change either. Ingest and the API run from source.
4. Run `bun run test:e2e`.

To run the Rust e2e lane:

1. Start Docker.
2. Install `cargo-nextest`.
3. Run `bun run test:e2e:rust`. It starts Garage and s2-lite in Docker with
   [`run-with-stack.ts`](../../../scripts/e2e/run-with-stack.ts), then runs the nextest `e2e`
   profile. A test reads the stack's addresses from the variables in
   [`build-stack-env.ts`](../../../stack/build-stack-env.ts), and fails when one is unset.

| Lane        | Real system                  | What it tests                                                                          | Run                                     |
| ----------- | ---------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------- |
| `e2e`, Rust | Garage and s2-lite in Docker | the host's fact log and blob store adapters                                            | `bun run test:e2e:rust`                 |
| `e2e`, Bun  | Garage and s2-lite in Docker | the `@pepys/ingest` fact log and blob store adapters, and the GitHub pull request path | `bun run test:e2e`                      |
| `model-api` | hosted models                | the requests that reach the models                                                     | `cargo nextest run --profile model-api` |

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
