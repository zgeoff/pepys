# The verify registry

Edit the globs in [`feature-paths.ts`](../../../../scripts/verify/feature-paths.ts) and
[`core-paths.ts`](../../../../scripts/verify/core-paths.ts). Write each glob relative to the repo
root. Edit the rest of a feature, such as its name and summary, in
[`create-verify-registry.ts`](../../../../scripts/verify/create-verify-registry.ts). The registry
reads each feature's `paths` from `featurePaths`, passes `sharedPaths` to `.shared()`, and passes
`ignoredPaths` to `.ignore()`.

`featurePaths` builds each feature's `paths` from three sources:

- `corePaths`, the packages and globs that every journey runs, such as the host, the stack, the kit,
  and the part of ingest and the API that every send and every query goes through. Each entry has a
  comment that says why every journey runs it.
- the feature's `packages`, each a package folder that its journey runs whole, such as
  `packages/source-telemetry`, with the folder of each workspace package it depends on.
  `feature-paths.ts` reads the dependencies from each `package.json` when it loads.
- the feature's `paths`, the globs for the parts of a package that its journey runs, such as the
  OAuth server in `packages/api`. `feature-paths.ts` adds the folders of that package's workspace
  dependencies itself, so list only the globs.

The dependency walk skips a package that `corePaths` splits into globs, such as `packages/api`. The
GitHub plug-in depends on the API, but each feature holds only the parts of the API that its own
journey runs.

A journey reaches a path when its sends, its reads or its `caught-up` run that path. Ingest, the API
and the host load every plug-in at start, and `bun verify doctor` runs before every journey, but
neither makes a path core. A change that breaks the start or `doctor` still fails each journey that
the change flags.

1. Put each path in the list for the journeys that reach it:
   - Add a path that one journey or a few reach to the `packages` or `paths` of those features.
   - Add a path that every journey reaches, by that rule, to `corePaths`, with a comment that says
     why.
   - Add a file that the running app reads, but that you can't trace to a journey, to `corePaths`.
     An extra journey run costs less than a missed feature.
   - Add a file that the running app never reads, such as a test or a test helper, to
     `ignoredPaths`. `bun verify gate` never asks for a verdict on a change to an ignored file, even
     when a feature's glob matches it too.
   - Add a verify helper that `bun verify up` runs to `sharedPaths`.
2. For each glob you add to `corePaths`, a feature or `sharedPaths`, check that an entry in
   [`skill-gate.json`](../../../../.claude/skill-gate.json) matches it, such as
   `{ "match": "packages/cli/e2e/fixtures/**", "skills": ["verify"] }`. With the entry, the
   skill-gate hook blocks an edit to a matching file until the agent loads this skill. It is a
   separate check from `bun verify gate`. For a glob you remove, delete an entry that only it used.
3. Run `bun test scripts/verify/feature-paths.test.ts`. Expect: the test passes. It fails when:
   - a tracked file that a feature or `sharedPaths` holds matches no `verify` entry in
     `skill-gate.json`;
   - a sample file flags other features than the test expects;
   - a tracked file matches no feature, shared or ignore glob.

   Fix the glob or the entry that the failure names, and run the test again. When you move a path on
   purpose, change the features that the test expects for its sample file.

Put the features and the globs in any order. A changed file counts for every feature whose glob
matches it. The order of the features sets only the row order of `bun verify features` and the
report.

After you add a feature, write its file under `references/`, and run the steps in
[Edit the skill and the registry](../SKILL.md#edit-the-skill-and-the-registry).
