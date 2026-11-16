# The verify registry

Edit a feature's `paths`, and the `ignoredPaths` list, in
[`feature-paths.ts`](../../../../scripts/verify/feature-paths.ts). Write each path as a glob
relative to the repo root. Edit the rest of a feature, such as its name and summary, in
[`create-verify-registry.ts`](../../../../scripts/verify/create-verify-registry.ts). It imports the
paths from `feature-paths.ts`, and passes `ignoredPaths` to the registry's `.ignore()`. SKILL.md
calls that list the registry's `.ignore` list.

- Add a glob to `ignoredPaths` only for files whose behaviour no journey exercises.
  `bun verify gate` never asks for a verdict on a change to an ignored file, even when a feature's
  glob matches it too.
- Put the features and the globs in any order. A changed file counts for every feature whose glob
  matches it. The order of the features sets only the row order of `bun verify features` and the
  report.
- For each new feature path, add an entry to [`skill-gate.json`](../../../skill-gate.json), with the
  glob as `match` and `["verify"]` as `skills`. The skill-gate hook reads that file, and blocks an
  edit to a matching file until you load this skill. It is a separate check from `bun verify gate`.
  When you change or remove a path, change or remove its entry too. An `ignoredPaths` glob needs no
  entry.
- After you add a feature, write its file under `references/`, and run the steps in
  [Edit the skill and the registry](../SKILL.md#edit-the-skill-and-the-registry).
