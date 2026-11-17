---
name: project-testing
description:
  pepys's test rules on top of the shared testing skill. They say where each kind of test file goes
  and which command runs it, where test helpers go, how Bun end-to-end tests start Docker services,
  how to test consumers, and how to add tests that call hosted models or live APIs. Load together
  with the testing skill when designing, writing, or reviewing pepys tests.
metadata:
  kind: rule-set
---

# pepys testing

## Facts

| Fact          | Where                                                                                                                                                                                                                                         |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test commands | Rust: each profile in [`nextest.toml`](../../../.config/nextest.toml), with the test paths it runs and its `slow-timeout`. Bun: the `test:e2e` script in [`package.json`](../../../package.json), with the folder it runs and its `--timeout` |
| Test utils    | `src/test-utils/` of the package that owns what the helper starts, builds or fakes, such as [`packages/api/src/test-utils`](../../../packages/api/src/test-utils)                                                                             |

## Departures

- For Bun, put a test that needs s2-lite or Garage in the `e2e/` folder of the package that owns the
  code it tests. For Rust, put it in an `e2e` module. The shared
  [slow tests reference](../testing/references/slow-tests.md) puts it in a `<name>.docker.test.ts`
  file, but pepys runs no command for such files. `bun run test` and `cargo nextest run` can't hold
  these tests either: s2-lite takes longer to start from a fresh image than the `slow-timeout` of
  the default profile in [`nextest.toml`](../../../.config/nextest.toml) and Bun's default test
  timeout allow.
- Put the e2e tests of the `@pepys/ingest` adapters in
  [`packages/ingest/e2e/`](../../../packages/ingest/e2e), with a prefix from
  [E2e prefixes](../testing/references/system-tests.md#e2e-prefixes). The shared
  [Package layout](../testing/references/system-tests.md#package-layout) rule allows an `e2e/`
  folder only in a package listed under `programs` in [`rig.config.ts`](../../../rig.config.ts).
  Only `@pepys/cli` is listed there. Keep the adapter tests in the ingest package, which holds the
  adapters.
- Start a process or seed data in [`start-stack.ts`](../../../packages/cli/e2e/start-stack.ts) when
  more than one e2e test needs it. Don't write the `start` and `stop` modules of
  [Files and shared hosts](../testing/references/system-tests.md#files-and-shared-hosts).
  `bun run test:e2e` loads `start-stack.ts` first, then runs only the `e2e/` folders that its script
  lists. Add a new `e2e/` folder to the script, or its tests never run.
- Leave `lanes` empty in `rig.config.ts`, in place of the `e2e` entry that Files and shared hosts
  puts there, and keep the `pepys` program entry. pepys runs the e2e tests with `bun run test:e2e`.
  `rig e2e` refuses `packages/ingest/e2e/`, because ingest declares no program.
- For an API test, seed a consumer's rows with
  [`create-consumer-version.ts`](../../../packages/api/src/test-utils/create-consumer-version.ts),
  in place of the shared [Seeding](../testing/references/seeding.md) rule. It writes
  `<store>/<consumer>/<version>/consumer.db` directly, as only the Rust host does, and the host runs
  only in the e2e lane. When you change a host table that the helper makes, such as `link`, change
  [`host-tables.json`](../../../packages/api/src/test-utils/host-tables.json) too: a host test
  checks it. Test the path from a fact to an API answer in `packages/cli/e2e/`.

## Where each test goes

| The test needs                                                             | Put it in                                                                                                   | Run it with                               |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| nothing outside the test process, a Turso database file, or a fake network | the file or module beside the code it tests                                                                 | `bun run test`, `cargo nextest run`       |
| s2-lite or Garage, from Bun                                                | a `<prefix>-<name>.test.ts` file in the `e2e/` folder of the package that owns the code                     | `bun run test:e2e`                        |
| s2-lite or Garage, from Rust                                               | a module named `e2e` in the crate, such as [`e2e.rs`](../../../crates/host/src/e2e.rs)                      | `bun run test:e2e:rust`                   |
| zig and wasm-tools, to run `pepys build --out` and compile consumers       | a `<prefix>-<name>.test.ts` file in the `e2e/` folder of the package that owns the code                     | `bun run test:e2e`                        |
| the public packages installed outside the repo, with a running host        | a step of [`run-outside-deployment.ts`](../../../scripts/outside-install/run-outside-deployment.ts)         | `bun run test:e2e:outside`                |
| hosted models                                                              | a module named `model_api` in the crate whose code calls the model                                          | `cargo nextest run --profile model-api`   |
| the live GitHub or Gmail API                                               | a module named `github_api` or `gmail_api`, as in [Tests that call a live API](#tests-that-call-a-live-api) | its nextest profile, such as `github-api` |

- Give a test that needs a Turso database its own database in a temporary file.
- Run a Rust test that needs a network fault on `turmoil`, a crate that simulates the network inside
  the test process.
- Name a Rust test module after its nextest profile, with `_` in place of `-`, so the test path
  starts with `e2e::` or `model_api::`. The default profile, which `cargo nextest run` uses, leaves
  those paths out.
- Give each s2-lite test, from Bun or Rust, a basin, the S2 namespace that holds streams. Use a name
  no other test in the same command uses, such as `conformance-<fixture file name>` in
  [`e2e.rs`](../../../crates/host/src/e2e.rs).

## Fixture files that Bun and Rust share

- Write the fact log and blob store fixture files in `packages/ingest/src/fact-log/fixtures/` and
  `packages/ingest/src/blob-store/fixtures/`. The existing tests in both languages run each file on
  every adapter: the memory and local folder adapters in `bun run test` and `cargo nextest run`, and
  the s2-lite and Garage adapters in `bun run test:e2e` and `bun run test:e2e:rust`.
- Add the name of a new fixture file to `for_each_fact_log_fixture!` in
  [`fact_log/fixtures.rs`](../../../crates/host/src/fact_log/fixtures.rs) or
  `for_each_blob_store_fixture!` in
  [`blob_store/fixtures.rs`](../../../crates/host/src/blob_store/fixtures.rs). Bun reads the whole
  folder, and a Rust test fails when the macro misses a file.
- Add each fact envelope case to
  [`fact-envelope-cases.json`](../../../packages/kit/src/fact-envelope-cases.json). The Bun test and
  the Rust test of the envelope both read the file, so `bun run test` and `cargo nextest run` each
  run every case.

## The consumers.json case file

`pepys build --out <directory>` writes `consumers.json` beside the compiled modules. Each case in
[`consumer-manifest-cases.json`](../../../packages/schema/src/consumer-manifest/consumer-manifest-cases.json)
holds one such file and whether the manifest schema accepts it. The Bun test of the schema runs
every case.

- Add a case for each new rule of the schema, with a `file` that breaks only that rule.
- Refresh the case "accepts the stub deployment" after you change a consumer of
  [`stub-deployment.ts`](../../../scripts/stub-deployment.ts), or the code in
  [`packages/cli/src/build/`](../../../packages/cli/src/build) that writes a consumer's glue:
  1. Set `PEPYS_ZIG_BIN` and `PEPYS_WASM_TOOLS_BIN`, as step 2 of
     [Bun tests in the e2e/ folders](#bun-tests-in-the-e2e-folders) says.
  2. Run `bun run consumers:build`.
  3. Replace the case's `file` with the `consumers.json` that step 2 writes in `build/consumers/`.

## Bun tests in the e2e/ folders

These tests run:

- the e2e deployment, with `pepys start`;
- the `@pepys/ingest` fact log and blob store adapters, on s2-lite and Garage;
- `pepys build`, which compiles consumers.

In the [logbook plug-in](../../../packages/cli/e2e/fixtures/logbook-plugin), import `@pepys/kit` by
package name, never by a relative path, as a plug-in outside the repo does.

- Read the addresses of the Docker services in each test's `setupTest()`, from the `PEPYS_`
  variables in [`build-stack-env.ts`](../../../stack/build-stack-env.ts), which
  [`start-stack.ts`](../../../packages/cli/e2e/start-stack.ts) sets.
- To test a new consumer, add its plug-in to
  [`e2e-deployment.ts`](../../../packages/cli/e2e/fixtures/e2e-deployment.ts), and add the consumer
  with its stream to `readConsumers` in `start-stack.ts`. The preload waits until each consumer in
  that list has caught up before the tests start, so a consumer left out may not have applied its
  facts.

To run them:

1. Start Docker.
2. Set `PEPYS_ZIG_BIN` and `PEPYS_WASM_TOOLS_BIN` to the paths of the zig and wasm-tools binaries,
   at the versions the Commands section of [AGENTS.md](../../../AGENTS.md) pins.
3. Run `bun run test:e2e:prepare`, which builds the host and the consumers of both deployments. Run
   it again after you change the host or a consumer.
4. Run `bun run test:e2e`.

## Rust tests in e2e modules

These tests run the host's fact log and blob store adapters on s2-lite and Garage, and `pepys up` on
the ledger plug-in's consumer as `bun run consumers:build` compiled it in `build/consumers/`.

- Read the addresses of the Docker services from the same `PEPYS_` variables, which
  [`run-with-stack.ts`](../../../scripts/e2e/run-with-stack.ts) sets. Make the test fail when one is
  unset.

To run them:

1. Start Docker.
2. Install `cargo-nextest`.
3. Set `PEPYS_ZIG_BIN` and `PEPYS_WASM_TOOLS_BIN`
   ([Bun tests in the e2e/ folders](#bun-tests-in-the-e2e-folders), step 2).
4. Run `bun run test:e2e:prepare`.
5. Run `bun run test:e2e:rust`. After the Rust tests, the script also runs
   `bun run test:e2e:outside`, the check of a deployment outside the repo in the Commands section of
   [AGENTS.md](../../../AGENTS.md). When only the outside check fails, look in a public package or
   the host.

## Consumer tests

- Feed a consumer inline facts, written in the test beside the assertion. The Consumers section of
  [project-code-style](../project-code-style/SKILL.md) defines a consumer.
- Assert the full returned operation list with `toStrictEqual`, never a single field of one
  operation, so an extra or missing operation fails the test.

## Tests that call hosted models

[`model-api.yml`](../../../.github/workflows/model-api.yml) runs
`cargo nextest run --profile model-api` nightly, on `workflow_dispatch`, and on a pull request that
changes the version of `@anthropic-ai/claude-agent-sdk` in `bun.lock`. A new SDK version can change
the requests that reach the models. On a pull request that leaves that version as it is, the
workflow skips the tests.

To run a new `model_api::` test before merge, dispatch the workflow on your branch:
`gh workflow run model-api.yml --ref <your-branch>`.

## Tests that call a live API

Give tests of the live GitHub API the module `github_api`, and tests of the live Gmail API the
module `gmail_api`. They call no model, so keep them out of `model_api`. With the first such test:

1. Add a profile to `nextest.toml`. Name it after the module, with `-` in place of `_`, such as
   `github-api`. Give it the `slow-timeout` of the `model-api` profile.
2. Add the module's test path to the paths that the `default-filter` of the default profile leaves
   out.
3. Add a workflow that runs the profile nightly and on `workflow_dispatch`, in the shape of
   `model-api.yml`.
