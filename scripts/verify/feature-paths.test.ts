import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { z } from 'zod';
import { featurePaths, ignoredPaths, sharedPaths } from './feature-paths.ts';

async function setupTest() {
  const gateSchema = z.object({ match: z.string(), skills: z.array(z.string()) });
  const rulesPath = join(import.meta.dir, '..', '..', '.claude', 'skill-gate.json');

  const rulesJSON: unknown = await Bun.file(rulesPath).json();

  const rules = z.object({ gates: z.array(gateSchema) }).parse(rulesJSON);

  return {
    rules,
    isIgnored: (path: string) => ignoredPaths.some((glob) => new Bun.Glob(glob).match(path)),
  };
}

test('it asks for the verify skill before an edit under each feature path and shared path', async () => {
  const ctx = await setupTest();

  const verifyGlobs = new Set(
    ctx.rules.gates.filter((gate) => gate.skills.includes('verify')).map((gate) => gate.match),
  );

  const mapped = [...Object.values(featurePaths).flat(), ...sharedPaths];

  expect(mapped.filter((glob) => !verifyGlobs.has(glob))).toStrictEqual([]);
});

test('it ignores each file a release pull request changes', async () => {
  const ctx = await setupTest();

  const releaseFiles = [
    'bun.lock',
    'package.json',
    'packages/api/package.json',
    'packages/source-github/package.json',
    'Cargo.toml',
    'Cargo.lock',
  ];

  expect(releaseFiles.filter((path) => !ctx.isIgnored(path))).toStrictEqual([]);
});

test.each([
  'packages/api/src/serve/serve-api.ts',
  'crates/host/src/main.rs',
  'stack/compose.yaml',
  'packages/cli/e2e/fixtures/e2e-deployment.ts',
])('it never ignores %s, which a journey runs', async (path) => {
  const ctx = await setupTest();

  expect(ctx.isIgnored(path)).toBe(false);
});
