import { join } from 'node:path';
import { collectReachedFolders } from './collect-reached-folders.ts';
import { corePaths } from './core-paths.ts';
import { readWorkspacePackages } from './read-workspace-packages.ts';
import type { WorkspacePackage } from './types.ts';

// Globs are root-relative, as `git ls-files` prints them, and match with Bun.Glob. A part that every
// start loads goes only in the features whose journey uses it: a change that breaks the start still
// fails each journey it flags.
interface FeatureReach {
  // package folders that the journey runs whole, with the workspace packages they depend on
  readonly packages: readonly string[];

  // the parts of a package that the journey runs, which bring that package's workspace dependencies
  readonly paths: readonly string[];
}

const workspace = await readWorkspace(join(import.meta.dir, '..', '..'));

// a pull request's opened and merged webhooks, from the fixture that signs them to the consumer
// that stores the pull request
const githubWebhooks: FeatureReach = {
  packages: [],
  paths: [
    'packages/cli/e2e/fixtures/{build-github-delivery,build-pull-request-fields,write-github-delivery}.ts',
    'packages/source-github/src/{github-plugin,github-pull-request-consumer,github-pull-request-schema-path,github-settings,github-source,index}.ts',
    'packages/source-github/src/consumers/github-pull-request.ts',
    'packages/source-github/src/generated/github-pull-request*',
    'packages/source-github/src/ingest/**',
    'packages/source-github/src/utils/find-field.ts',

    // the families that the source loads and no journey sends
    'packages/source-github/src/families/{build-family-types,issue-comment-family,issue-family,pull-request-family,repository-family,review-comment-family,review-thread-family,workflow-run-family}.ts',
  ],
};

// a release's webhook, and the delivery query, which reads a merged pull request's release and
// deploy
const githubDelivery: FeatureReach = {
  packages: [],
  paths: [
    'packages/cli/e2e/fixtures/build-github-release-delivery.ts',
    'packages/source-github/src/queries/**',
    'packages/source-github/src/github-{deploy,ref,release}-consumer.ts',
    'packages/source-github/src/consumers/github-{deploy,ref,release}.ts',
    'packages/source-github/src/generated/github-{deploy,ref,release}*',
    'packages/source-github/src/families/{deployment,ref,release}-family.ts',
    'packages/source-github/src/utils/deploy-signals.ts',
  ],
};

// an OpenTelemetry export, which ingest takes only from a sender with a signed identity
const telemetry: FeatureReach = {
  packages: ['packages/source-telemetry'],
  paths: ['packages/ingest/src/sender-proof/imp-identity/**'],
};

const logbookPlugin = 'packages/cli/e2e/fixtures/logbook-plugin/src/{index,logbook-plugin}.ts';

// Each feature holds the core list, the folders of its packages and of the workspace packages they
// depend on, from each `package.json` as this file loads, and the parts of packages it names.
export const featurePaths = {
  'pull-request-delivery': buildFeatureGlobs(
    workspace,
    buildJoinedReach(githubWebhooks, githubDelivery, {
      packages: [],
      paths: [
        'packages/cli/e2e/fixtures/build-github-review-delivery.ts',
        'packages/source-github/src/families/pull-request-review-family.ts',
      ],
    }),
  ),
  'session-model-requests': buildFeatureGlobs(workspace, telemetry),
  'entity-neighbourhood': buildFeatureGlobs(
    workspace,
    buildJoinedReach(githubWebhooks, {
      packages: [],
      paths: [
        'packages/api/src/queries/{get-entity,neighbourhood}/**',
        logbookPlugin,
        'packages/cli/e2e/fixtures/logbook-plugin/src/{consumers,generated}/**',
        'packages/cli/e2e/fixtures/logbook-plugin/src/{logbook-source,logbook-voyage-consumer,voyage-family}.ts',
      ],
    }),
  ),
  'host-restart-recovery': buildFeatureGlobs(workspace, githubWebhooks),
  'mcp-queries': buildFeatureGlobs(
    workspace,
    buildJoinedReach(githubWebhooks, githubDelivery, telemetry, {
      packages: [],
      paths: [
        // the OAuth server in front of /mcp
        'packages/api/src/oauth/**',

        // `mcp tools` lists the logbook plug-in's query
        logbookPlugin,
        'packages/cli/e2e/fixtures/logbook-plugin/src/harbour-voyages-query.ts',
      ],
    }),
  ),
} as const satisfies Record<string, readonly string[]>;

interface Workspace {
  readonly packages: readonly WorkspacePackage[];
  readonly coreFolders: readonly string[];
  readonly splitFolders: readonly string[];
}

function buildFeatureGlobs(workspaceFacts: Workspace, reach: FeatureReach): string[] {
  const ownerFolders = collectOwnerFolders(reach.paths, workspaceFacts.packages);

  // a split package's other parts run only where a feature names them
  const skippedFolders = new Set([
    ...workspaceFacts.coreFolders,
    ...workspaceFacts.splitFolders,
    ...ownerFolders,
  ]);

  const ownFolders = collectReachedFolders(
    [...reach.packages, ...ownerFolders],
    workspaceFacts.packages,
  ).filter((folder) => !skippedFolders.has(folder));

  return [
    ...workspaceFacts.coreFolders.map((folder) => `${folder}/**`),
    ...corePaths.globs,
    ...ownFolders.map((folder) => `${folder}/**`),
    ...reach.paths,
  ];
}

// The folder of the package that holds each glob, the deepest when packages nest.
function collectOwnerFolders(
  globs: readonly string[],
  packages: readonly WorkspacePackage[],
): string[] {
  const owners = globs.flatMap((glob) => {
    const holders = packages
      .map((entry) => entry.folder)
      .filter((folder) => glob.startsWith(`${folder}/`))
      .toSorted((first, second) => second.length - first.length);

    return holders.slice(0, 1);
  });

  return [...new Set(owners)];
}

async function readWorkspace(rootDir: string): Promise<Workspace> {
  const packages = await readWorkspacePackages(rootDir);

  return {
    packages,
    coreFolders: collectReachedFolders(corePaths.packages, packages),
    splitFolders: collectOwnerFolders(corePaths.globs, packages),
  };
}

function buildJoinedReach(...reaches: readonly FeatureReach[]): FeatureReach {
  return {
    packages: reaches.flatMap((reach) => reach.packages),
    paths: reaches.flatMap((reach) => reach.paths),
  };
}

// A change to one of these changes every feature: the verify CLI, its `local` app and its doctor.
export const sharedPaths = ['scripts/verify/**'] as const;

// A path that one of these globs matches counts as no change, even where a feature's or a shared
// glob matches it too, so the gate skips it. Add a glob only for files that no journey runs.
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
  '.agents/**',
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

  // 4. Code that no journey runs: `pepys start` and the entries that the `local` app replaces, test
  //    helpers and the host's test modules, the stub deployment's dock plug-in, and enrichment,
  //    which no package imports.
  'packages/cli/src/index.ts',
  'packages/cli/src/start/**',
  'packages/source-github/src/{api/serve-api,ingest/serve-ingest}.ts',
  'packages/*/src/**/test-utils/**',
  'crates/host/src/{e2e,test_utils,blob_store/fixtures,fact_log/fixtures}.rs',
  'crates/host/src/e2e/**',
  'packages/testing/src/dock/**',
  'packages/testing/src/*.ts',
  'packages/testing/src/{consumer-entries,fact-index,fact-log,fact-mode,links,memory-store-reader,operations,orders,rows,scope-replace,store-database,test-store,test-utils,utils}/**',
  'packages/mock-network/**',
  'packages/enrichment/**',

  // the telemetry forwarder, which runs on a machine outside the app and posts to ingest
  'packages/source-telemetry/src/forwarder/**',
  'packages/source-telemetry/src/forwarder-bin.ts',
] as const;
