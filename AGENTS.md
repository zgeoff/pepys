# Agent Guidelines

pepys is a personal data hub: it ingests the owner's own GitHub and Gmail data as immutable facts,
builds entities and cross-source links from them, and serves them through typed queries, MCP, and
change streams. `docs/README.md` indexes the docs.

## Required reading

The rules a task needs are not repeated here. Load the skill for the work before starting it.

| Skill                | Load before                                                                     |
| -------------------- | ------------------------------------------------------------------------------- |
| `code-style`         | writing, reviewing, or renaming any TypeScript                                  |
| `project-code-style` | the same, beside `code-style` — pepys's additions to it                         |
| `testing`            | designing, writing, or reviewing tests                                          |
| `project-testing`    | the same, beside `testing` — pepys's test regime                                |
| `docs-writing`       | writing or editing any committed prose: `docs/`, READMEs, this file, skills     |
| `skill-writing`      | writing or editing a skill under `.claude/skills/`                              |
| `ci-design`          | adding or changing a CI workflow, a required check, or a package script CI runs |

## Repo structure

pepys is one Bun workspace. The root package holds the repo tooling.

```text
packages/   the @pepys/* workspace packages, one folder each
scripts/    the repo tooling
docs/
  design/   designs for work that is not built yet
```

## Packages

- Every version lives once in the `workspaces.catalog` of the root `package.json`, as an exact pin.
  A package depends on it as `catalog:`.
- A package is private and named `@pepys/<folder>`.
- A package exports `./src/index.ts`. Internal packages have no build step.

## Commands

- `bun run typecheck`, `bun run lint`, and `bun run test` are the local checks. Run `bun test` from
  the root.
- `bun run lint:full` adds the type-aware pass and the type check. It runs in CI only, so never run
  it locally.
- lefthook runs the light checks before a commit and a push. Leave the larger checks to CI.
