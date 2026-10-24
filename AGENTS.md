# Agent Guidelines

pepys is a personal data hub: it ingests the owner's own data from pluggable sources as immutable
facts, builds entities and cross-source links from them, and serves them through typed queries, MCP,
and change streams. `docs/README.md` indexes the docs.

## Required reading

The rules a task needs are not repeated here. Load the skill for the work before starting it.

| Skill                  | Load before                                                                     |
| ---------------------- | ------------------------------------------------------------------------------- |
| `code-style`           | writing, reviewing, or renaming any TypeScript                                  |
| `project-code-style`   | the same, beside `code-style` — pepys's additions to it                         |
| `testing`              | designing, writing, or reviewing tests                                          |
| `project-testing`      | the same, beside `testing` — pepys's test regime                                |
| `docs-writing`         | writing or editing any committed prose: `docs/`, READMEs, this file, skills     |
| `project-docs-writing` | the same, beside `docs-writing` — where spikes live and when they go            |
| `skill-writing`        | writing or editing a skill under `.claude/skills/`                              |
| `ci-design`            | adding or changing a CI workflow, a required check, or a package script CI runs |

## Repo structure

pepys is one Bun workspace and one Cargo workspace. The root package holds the repo tooling.

```text
crates/     the Rust crates, one folder each
packages/   the @pepys/* workspace packages, one folder each
research/   spikes, one Bun package each
scripts/    the repo tooling
docs/
  design/   designs for work that is not built yet
```

## Packages

- Every version lives once in the `workspaces.catalog` of the root `package.json`, as an exact pin.
  A package depends on it as `catalog:`.
- A package is private and named `@pepys/<folder>`.
- A package exports `./src/index.ts`. Internal packages have no build step.
- A spike under `research/` is the exception to the catalog rule: it pins its own exact versions,
  because it records what it ran against.

## Crates

- `rust-toolchain.toml` pins the toolchain. A `RUSTUP_TOOLCHAIN` variable in the shell overrides the
  pin, so unset it before running cargo here.
- Every crate version lives once in `[workspace.dependencies]` of the root `Cargo.toml`, as an exact
  `=x.y.z` pin, and a crate depends on it with `workspace = true`. Pick the newest release at least
  7 days old, matching `minimumReleaseAge`. `Cargo.lock` is committed.
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
- lefthook runs the light checks before a commit and a push. Leave the larger checks to CI.
