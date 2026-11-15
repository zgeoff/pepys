# The verify registry

Edit a feature's `paths`, and the `ignoredPaths` list, in
[`feature-paths.ts`](../../../../scripts/verify/feature-paths.ts). Each path is a glob relative to
the repo root. Edit the rest of a feature, such as its name and summary, in
[`create-verify-registry.ts`](../../../../scripts/verify/create-verify-registry.ts), which imports
the paths from `feature-paths.ts`.

- Add a glob to `ignoredPaths` only for files whose behaviour no journey exercises.
  `bun verify gate` never asks for a verdict on a change to an ignored file.
- For each new feature path, add an entry to [`skill-gate.json`](../../../skill-gate.json), with the
  glob as `match` and `["verify"]` as `skills`. With the entry in place, you load this skill before
  you edit a file the glob matches. When you change or remove a path, change or remove its entry
  too. An `ignoredPaths` glob needs no entry.
- After you add a feature, write its file under `references/`, and run the steps in
  [Edit the skill and the registry](../SKILL.md#edit-the-skill-and-the-registry).
