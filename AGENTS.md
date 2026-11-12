# Agent Guidelines

pepys is a personal data hub: it ingests the owner's own data from pluggable sources as immutable
facts, builds entities and cross-source links from them, and serves them through typed queries, MCP,
and change streams. `docs/README.md` indexes the docs.

## Required reading

The rules a task needs are not repeated here. Load the skill for the work before starting it.

| Skill                  | Load before                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `code-style`           | writing, reviewing, or renaming any TypeScript                                                    |
| `project-code-style`   | the same, beside `code-style` — pepys's additions to it                                           |
| `testing`              | designing, writing, or reviewing tests                                                            |
| `project-testing`      | the same, beside `testing` — pepys's test regime                                                  |
| `docs-writing`         | writing or editing any committed prose: `docs/`, READMEs, this file, skills                       |
| `project-docs-writing` | the same, beside `docs-writing` — where spikes live and when they go                              |
| `skill-writing`        | writing or editing a skill under `.claude/skills/`                                                |
| `cold-read`            | checking a skill you wrote or changed, before its PR                                              |
| `deslop`               | editing the prose of a skill you wrote or changed, before its PR                                  |
| `ci-design`            | adding or changing a CI workflow, a required check, a package script CI runs, or a dependency pin |

When you write or edit a skill:

1. Load the `skill-writing`, `cold-read` and `deslop` skills from `.claude/skills/`. repo-sync
   delivers them there at the `zgeoff/skills` commit that `zgeoff/tools` pins, so install none of
   them yourself.
2. Do every step in the "Check it" section of `.claude/skills/skill-writing/SKILL.md`.
3. In the PR description, after the sections of the repo's PR template, add three `##` headings:
   - "Skill checks": the check output.
   - "Cold read": each cold-read finding, and how you answered it.
   - "Deslop": each change deslop made, or "none".

## Repo structure

pepys is one Bun workspace and one Cargo workspace. The root package holds the repo tooling.

```text
crates/     the Rust crates, one folder each
packages/   the @pepys/* workspace packages, one folder each
research/   spikes, one Bun package each
scripts/    the repo tooling
docs/
  architecture/  how the built system works
  runbooks/      how to deploy and release
  design/        designs for work that is not built yet
  decisions/     numbered decision records
```

## Packages

- Every version lives once in the `workspaces.catalog` of the root `package.json`, as an exact pin.
  A package depends on it as `catalog:`.
- A package is named `@pepys/<folder>`. The one exception is `e2e/logbook-plugin`, the e2e lane's
  private plug-in, which takes the name an outside plug-in would. A package that a plug-in or a
  deployment imports is public on npm: `api`, `cli`, `contract`, `ingest`, `kit`, `kysely-turso`,
  `schema`, `source-github`, `source-telemetry` and `testing`. A public package has no `private`, a
  `version`, a `license`, `repository` with its `directory`, a `files` list that leaves out tests
  and `test-utils`, `publishConfig.access` of `public`, and a README. Every other package is
  private.
- A public package imports no private workspace package, and depends on each package it imports in
  shipped code, not as a dev dependency. Its `files` list leaves out each test helper outside
  `test-utils`, such as the ingest fixture runners.
- A package exports `./src/index.ts`, and has no build step. A public package ships its TypeScript
  source for Bun: scriptc compiles a consumer from source, and `pepys build` copies a dependency's
  `src`. A plug-in's compiler checks that source with the plug-in's own options, so shipped code
  type-checks with the options in the [kit's README](packages/kit/README.md#configuration), and
  needs every type it uses from a dependency, never a peer.
- Every public package carries one version. To release, set that version in each public
  `package.json` in one pull request, with `bun.lock` written by the pinned bun. Then push the tag
  `v<version>` on `main`: [`release.yml`](.github/workflows/release.yml) checks the tag against each
  version, packs each package once, installs the tarballs outside the repo, and publishes them to
  npm with provenance. Its `release-host` job builds the host binary and makes the GitHub release of
  the tag with the binary and its `SHA256SUMS`. The rules a deploy of that binary relies on are in
  [Fetch the host](docs/runbooks/deploying.md#3-fetch-the-host), and
  [Releasing](docs/runbooks/releasing.md) covers a run that fails.
- `bun run check:outside-install` installs every public package into an empty folder outside the
  repo, type-checks a stub plug-in there, and runs a query test on the test store. It packs the
  packages first, or with `PEPYS_OUTSIDE_VERSION` set it installs that version from npm.
- A spike under `research/` is the exception to the catalog rule: it pins its own exact versions,
  because it records what it ran against.

## Crates

- `rust-toolchain.toml` pins the toolchain. A `RUSTUP_TOOLCHAIN` variable in the shell overrides the
  pin, so unset it before running cargo here.
- Every crate version lives once in `[workspace.dependencies]` of the root `Cargo.toml`, as an exact
  `=x.y.z` pin, and a crate depends on it with `workspace = true`. `Cargo.lock` is committed.
- Pin each crate, and each Bun package, by the
  [Dependency exceptions](.claude/skills/ci-design/SKILL.md#dependency-exceptions) rule in
  ci-design. For a crate you pin by hand, read the release age off crates.io yourself: `bun install`
  holds back only a Bun package younger than the `minimumReleaseAge` in `bunfig.toml`, and pepys
  sets no release age for cargo.
- A crate is named `pepys-<folder>`, takes its edition, license and lints from the workspace, and
  sets `[lints] workspace = true`.
- Errors use `thiserror` at module boundaries, and every fallible function returns `Result`.
- For faster development builds on Linux, link with wild through your own `~/.cargo/config.toml`;
  the repo leaves the default linker in place, which release builds use.

## Commands

- `bun run typecheck`, `bun run lint`, and `bun run test` are the local checks. Run `bun test` from
  the root.
- `bun run lint:full` adds the type-aware pass and the type check. It runs in CI only, so never run
  it locally.
- `cargo clippy --workspace --all-targets -- -D warnings` and `cargo nextest run` are the local Rust
  checks; `bacon` runs clippy on every save. CI also runs `cargo fmt --check`, `cargo shear`,
  `cargo deny check` and `cargo test --doc`, because nextest skips doctests.
- `bun run schema:generate` writes the generated files, and `bun run schema:check` writes nothing
  and exits 1 on a stale one. Neither needs Docker. The generated files are the store's Kysely types
  and each consumer's glue: its boundary file and its SQL schema. Both scripts build the glue with
  the same code as `pepys build <path-to-plug-in-file> [--check]` in `@pepys/cli`.
- `bun run consumers:build` runs `pepys build` on two deployments. It compiles each consumer of the
  repo's stub deployment, `scripts/stub-deployment.ts`, to `build/consumers/<name>/<hash>.wasm` and
  writes `build/consumers/consumers.json`. It writes the same for the e2e deployment,
  `e2e/deployment/e2e-deployment.ts`, under `build/e2e-consumers/`. It needs zig 0.16.0 and
  wasm-tools 1.262.0, the version CI pins, at `PEPYS_ZIG_BIN` and `PEPYS_WASM_TOOLS_BIN`.
- `bun run test:e2e` runs the e2e lane against Garage and s2-lite in Docker. The lane runs ingest,
  the host and the API of the e2e deployment: the GitHub and telemetry plug-ins, and the logbook
  plug-in in `e2e/logbook-plugin/`, which imports the kit by package name as an outside plug-in
  does. A signed webhook, a signed fact batch and an OTLP logs export with an identity token go in
  through ingest, and the tests read the rows through the API. The deployment also holds the ledger
  scope consumer of the stub deployment, on records the setup appends to s2-lite. The lane needs
  Docker, the host built at `target/debug/pepys` and the consumers built, so run
  `bun run test:e2e:prepare` first, with the same two variables set. The `e2e` job in `pr.yml` runs
  the lane on every pull request.
- The host, `target/debug/pepys`, runs `up [<consumer>]`, `run [--up]` and `preview <consumer>` from
  the `consumers.json` at `PEPYS_CONSUMERS`, such as `build/consumers/consumers.json`, with the
  store at `PEPYS_STORE_DIR` and the S2 log at the `PEPYS_S2_` variables.
- `bun run test:e2e:rust` runs the Rust e2e lane, the fact log and blob store fixtures on s2-lite
  and Garage, in a stack of its own, and the compiled ledger scope consumer through `pepys up`. It
  needs Docker, `cargo-nextest` and the consumers built. The `e2e` job runs it after the Bun lane.
  It then runs `bun run test:e2e:outside`.
- `bun run test:e2e:outside` checks a deployment outside the repo. In an empty folder it installs
  every public package as `check:outside-install` does, runs `pepys build` on a stub deployment,
  compiles the deployment's API entry plain and minified and runs `passkeys` on each binary, and
  starts a host with `run --up` on s2-lite until each consumer is current. It needs Docker and the
  two tool variables. The host is `target/debug/pepys` by default, the binary at
  `PEPYS_OUTSIDE_HOST`, or, with `PEPYS_OUTSIDE_HOST_TAG=v<version>`, the release's
  `pepys-host-linux-x64`, which the check downloads and checks against the release's `SHA256SUMS`.
  To check a release, set `PEPYS_OUTSIDE_VERSION=<version>` and `PEPYS_OUTSIDE_HOST_TAG=v<version>`.
- `bun packages/source-github/src/api/serve-api.ts` starts the API, which serves oRPC under `/rpc`.
  It reads `PEPYS_STORE_DIR`, the store the host writes, `PEPYS_API_HOST`, which defaults to
  127.0.0.1, and `PEPYS_API_PORT`, which defaults to 8081. With `PEPYS_API_PUBLIC_URL` and
  `PEPYS_AUTH_DIR` set, it also serves MCP at `/mcp` behind the OAuth server in
  [OAuth server](docs/design/api-auth/oauth.md). Given `passkeys`, `clients` or `grants`, it runs
  that admin command on the OAuth server's database and exits.
- lefthook runs the light checks before a commit and a push. Leave the larger checks to CI.
