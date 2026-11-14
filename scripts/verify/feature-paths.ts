// Globs are root-relative, as `git ls-files` prints them, and match with Bun.Glob. A path is in a
// feature when the feature's journey runs it: every journey runs the e2e deployment on Garage and
// s2-lite, with ingest, the API and the host, and the consumers that `pepys build` compiled.
const everyJourney = [
  'packages/{api,contract,ingest,kit,kysely-turso,schema}/**',
  'packages/cli/src/{build,utils,test-utils}/**',
  'packages/cli/e2e/fixtures/**',
  'packages/testing/src/ledger/**',
  'crates/host/**',
  'stack/**',
] as const;

export const featurePaths = {
  'pull-request-delivery': [...everyJourney, 'packages/source-github/**'],
  'session-model-requests': [...everyJourney, 'packages/source-telemetry/**'],
  'entity-neighbourhood': [...everyJourney, 'packages/source-github/**'],
  'host-restart-recovery': [...everyJourney, 'packages/source-github/**'],
} as const satisfies Record<string, readonly string[]>;

// A change to one of these changes every feature: the verify CLI, its `local` app and its doctor.
export const sharedPaths = ['scripts/verify/**'] as const;

// A path that one of these globs matches counts as no change, even where a feature's or a shared
// glob matches it too.
export const ignoredPaths = [
  // 1. No runtime effect: prose and tests. Never `**/*.md`: a package may read markdown at run time.
  'docs/**',
  '**/README.md',
  'AGENTS.md',
  'CLAUDE.md',
  'LICENSE',
  '**/*.test.ts',
  'packages/cli/e2e/*.ts',
  'packages/ingest/e2e/**',
  'research/**',

  // 2. Build, lint, CI and editor wiring, which Bun never reads when it runs the source.
  '**/tsconfig*.json',
  'bunfig.toml',
  'rig.config.ts',
  'knip.json',
  '.oxlintrc.json',
  '.oxfmtrc.json',
  '.formatignore',
  '.editorconfig',
  '.gitattributes',
  '.gitignore',
  '.gitleaks.toml',
  'commitlint.config.js',
  'lefthook.yml',
  'audit-ignores.json',
  'socket.yml',
  'review.json',
  'renovate.json',
  'deny.toml',
  'rustfmt.toml',
  '.config/**',
  '.claude/**',
  '.codex/**',
  '.github/**',

  // the repo scripts other than the verify CLI
  'scripts/{agent-sdk-bump,checks,e2e,outside-install,pr-title,release,test-leftovers,test-utils,utils,verify-gate}/**',
  'scripts/*.{ts,sh}',

  // 3. The files a dependency bump or a release changes: each package's version, the catalog, the
  //    lock files and the toolchain pins. A dependency bump merges on green CI, and a release pull
  //    request changes only versions.
  '**/package.json',
  'bun.lock',
  '.bun-version',
  'Cargo.toml',
  'Cargo.lock',
  'rust-toolchain.toml',

  // 4. Code that no journey runs: `pepys start` and the CLI's entry, which the `local` app replaces
  //    with its own start; the test store and the test network of unit tests; and enrichment, which
  //    no package imports.
  'packages/cli/src/*.ts',
  'packages/cli/src/start/**',
  'packages/testing/src/*.ts',
  'packages/testing/src/{consumer-entries,fact-index,fact-log,fact-mode,links,memory-store-reader,operations,orders,rows,scope-replace,store-database,test-store,test-utils,utils}/**',
  'packages/mock-network/**',
  'packages/enrichment/**',
] as const;
