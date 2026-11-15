# The verify registry

Edit a feature's globs in [`feature-paths.ts`](../../../../scripts/verify/feature-paths.ts), and
everything else about a feature in
[`create-verify-registry.ts`](../../../../scripts/verify/create-verify-registry.ts), which reads the
globs from `feature-paths.ts`.

- Add a glob to `ignoredPaths` only for files that no journey runs. A change to an ignored file
  skips the gate.
- For each new feature glob, add a gate to [`skill-gate.json`](../../../skill-gate.json), with the
  glob as `match` and `["verify"]` as `skills`. The gate makes an agent load this skill before it
  edits a file the glob matches. When you change or remove a glob, change or remove its gate too.
