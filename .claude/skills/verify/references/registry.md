# The verify registry

Read this before you add a feature, change a feature's `paths`, or add a glob to the `.ignore` list.

The registry, [`create-verify-registry.ts`](../../../../scripts/verify/create-verify-registry.ts),
declares the targets, actions, commands, doctor checks and features. It reads each feature's `paths`
and the `.ignore` list from [`feature-paths.ts`](../../../../scripts/verify/feature-paths.ts).

- Add a glob to the `.ignore` list only for files the running app never reads.
- For each new feature glob, add an entry to [`skill-gate.json`](../../../skill-gate.json), with the
  glob as `match` and `verify` as its skill.
