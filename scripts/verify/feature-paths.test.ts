import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { collectFeatureScopes, isGlobMatch } from '@wringer/core';
import { z } from 'zod';
import { createVerifyRegistry } from './create-verify-registry.ts';

async function setupTest() {
  const gateSchema = z.object({ match: z.string(), skills: z.array(z.string()) });
  const rootDir = join(import.meta.dir, '..', '..');
  const rulesPath = join(rootDir, '.claude', 'skill-gate.json');

  const rulesJSON: unknown = await Bun.file(rulesPath).json();

  const rules = z.object({ gates: z.array(gateSchema) }).parse(rulesJSON);
  const registry = createVerifyRegistry();
  const scopes = collectFeatureScopes(registry);

  const trackedText = await Bun.$`git ls-files`.cwd(rootDir).text();

  return {
    rules,
    featureNames: registry.features.map((feature) => feature.name),
    trackedPaths: trackedText.trim().split('\n'),
    isIgnored: (path: string) => isGlobMatch(path, registry.ignore),
    collectFlagged: (path: string) =>
      isGlobMatch(path, registry.ignore)
        ? []
        : scopes.filter((scope) => isGlobMatch(path, scope.globs)).map((scope) => scope.name),
  };
}

test('it asks for the verify skill before an edit to each file that a feature or shared path holds', async () => {
  const ctx = await setupTest();

  const verifyGlobs = ctx.rules.gates
    .filter((gate) => gate.skills.includes('verify'))
    .map((gate) => gate.match);

  const mapped = ctx.trackedPaths.filter((path) => ctx.collectFlagged(path).length > 0);

  expect(mapped.filter((path) => !isGlobMatch(path, verifyGlobs))).toStrictEqual([]);
});

test.each([
  {
    path: 'packages/source-github/src/families/pull-request-review-family.ts',
    flagged: ['pull-request-delivery'],
  },
  {
    path: 'packages/cli/e2e/fixtures/build-github-review-delivery.ts',
    flagged: ['pull-request-delivery'],
  },
  {
    path: 'packages/source-github/src/queries/select-pull-request-delivery.ts',
    flagged: ['pull-request-delivery', 'mcp-queries'],
  },
  {
    path: 'packages/source-github/src/consumers/github-release.ts',
    flagged: ['pull-request-delivery', 'mcp-queries'],
  },
  {
    path: 'packages/source-telemetry/src/otlp/parse-logs-export.ts',
    flagged: ['session-model-requests', 'mcp-queries'],
  },
  {
    path: 'packages/source-telemetry/src/consumers/telemetry-model-request.ts',
    flagged: ['session-model-requests', 'mcp-queries'],
  },
  {
    path: 'packages/ingest/src/sender-proof/imp-identity/read-imp-identity-sender-proof.ts',
    flagged: ['session-model-requests', 'mcp-queries'],
  },
  {
    path: 'packages/api/src/queries/neighbourhood/walk-neighbourhood.ts',
    flagged: ['entity-neighbourhood'],
  },
  {
    path: 'packages/api/src/queries/get-entity/read-entity.ts',
    flagged: ['entity-neighbourhood'],
  },
  {
    path: 'packages/cli/e2e/fixtures/logbook-plugin/src/logbook-voyage-consumer.ts',
    flagged: ['entity-neighbourhood'],
  },
  {
    path: 'packages/cli/e2e/fixtures/logbook-plugin/src/harbour-voyages-query.ts',
    flagged: ['mcp-queries'],
  },
  {
    path: 'packages/api/src/oauth/http/start-mcp-http-server.ts',
    flagged: ['mcp-queries'],
  },
  {
    path: 'packages/source-github/src/ingest/read-github-delivery.ts',
    flagged: [
      'pull-request-delivery',
      'entity-neighbourhood',
      'host-restart-recovery',
      'mcp-queries',
    ],
  },
  {
    path: 'packages/source-github/src/consumers/github-pull-request.ts',
    flagged: [
      'pull-request-delivery',
      'entity-neighbourhood',
      'host-restart-recovery',
      'mcp-queries',
    ],
  },
])('it flags only the features whose journey reaches $path', async (row) => {
  const ctx = await setupTest();

  expect(ctx.collectFlagged(row.path)).toStrictEqual([...row.flagged]);
});

test.each([
  'crates/host/src/main.rs',
  'stack/compose.yaml',
  'packages/kit/src/index.ts',
  'packages/schema/src/index.ts',
  'packages/ingest/src/serve/serve-ingest.ts',
  'packages/api/src/serve/serve-api.ts',
  'packages/api/src/app/create-router.ts',
  'packages/cli/src/build/compile-consumer.ts',
  'packages/cli/src/run-cli.ts',
  'packages/cli/e2e/fixtures/e2e-deployment.ts',
  'packages/cli/e2e/fixtures/start-e2e-stack.ts',
  'packages/testing/src/ledger/ledger-plugin.ts',
  'scripts/verify/create-verify-registry.ts',
])('it flags every feature for a change to the core file %s', async (path) => {
  const ctx = await setupTest();

  expect(ctx.collectFlagged(path)).toStrictEqual(ctx.featureNames);
});

test.each([
  'packages/source-github/src/api/serve-api.ts',
  'packages/source-github/src/ingest/serve-ingest.ts',
  'packages/testing/src/dock/dock-plugin.ts',
  'packages/api/src/test-utils/start-live-writer.ts',
  'packages/cli/src/start/run-start.ts',
  'crates/host/src/e2e.rs',
])('it flags no feature for %s, which no journey runs', async (path) => {
  const ctx = await setupTest();

  expect(ctx.collectFlagged(path)).toStrictEqual([]);
});

test('it maps every tracked file to a feature or the ignore list', async () => {
  const ctx = await setupTest();

  expect(
    ctx.trackedPaths.filter(
      (path) => !ctx.isIgnored(path) && ctx.collectFlagged(path).length === 0,
    ),
  ).toStrictEqual([]);
});
