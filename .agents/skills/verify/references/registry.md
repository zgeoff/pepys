# The verify registry

Edit a feature's `paths`, the `sharedPaths` list and the `ignoredPaths` list in
[`feature-paths.ts`](../../../../scripts/verify/feature-paths.ts). Write each path as a glob
relative to the repo root. Edit the rest of a feature, such as its name and summary, in
[`create-verify-registry.ts`](../../../../scripts/verify/create-verify-registry.ts). It imports the
lists from `feature-paths.ts`, and passes `sharedPaths` to the registry's `.shared()` and
`ignoredPaths` to its `.ignore()`, the two calls SKILL.md names.

- Add a glob to `sharedPaths` for a file whose change changes every feature, such as the verify CLI.
- Add a glob to `ignoredPaths` only for a file that no journey runs. That covers more than the files
  SKILL.md names for `.ignore()`, which the running app never reads, such as a test: it also covers
  code a journey never reaches, such as `pepys start`, which the `local` app replaces with its own
  start. `bun verify gate` never asks for a verdict on a change to an ignored file, even when a
  feature's glob matches it too.
- Put the features and the globs in any order. A changed file counts for every feature whose glob
  matches it. The order of the features sets only the row order of `bun verify features` and the
  report.
- For each new feature path and each `sharedPaths` glob, add an entry to
  [`skill-gate.json`](../../../../.claude/skill-gate.json), with the glob as `match` and
  `["verify"]` as `skills`. The skill-gate hook reads that file, and blocks an edit to a matching
  file until you load this skill. It is a separate check from `bun verify gate`. When you change or
  remove a path, change or remove its entry too. An `ignoredPaths` glob needs no entry.
- After you add a feature, write its file under `references/`, and run the steps in
  [Edit the skill and the registry](../SKILL.md#edit-the-skill-and-the-registry).
