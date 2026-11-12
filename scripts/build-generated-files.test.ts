import { expect, test } from 'bun:test';
import invariant from 'tiny-invariant';
import { buildGeneratedFiles } from './build-generated-files.ts';

test('it builds the files that are committed', async () => {
  const generated = buildGeneratedFiles();

  invariant(generated.ok);

  const committed = await Promise.all(
    generated.files.map(async (file) => ({
      path: file.path,
      content: await Bun.file(`${import.meta.dir}/../${file.path}`).text(),
    })),
  );

  expect(committed).toStrictEqual(generated.files);
});

test('it builds the same files on each call', () => {
  expect(buildGeneratedFiles()).toStrictEqual(buildGeneratedFiles());
});

test('it builds the files of the github, ledger, telemetry and logbook consumers', () => {
  const generated = buildGeneratedFiles();

  invariant(generated.ok);

  expect(generated.files.map((file) => file.path)).toStrictEqual([
    'packages/schema/src/generated/kysely-db.ts',
    'packages/source-github/src/generated/github-pull-request-boundary.ts',
    'packages/source-github/src/generated/github-pull-request.sql',
    'packages/source-github/src/generated/github-release-boundary.ts',
    'packages/source-github/src/generated/github-release.sql',
    'packages/source-github/src/generated/github-ref-boundary.ts',
    'packages/source-github/src/generated/github-ref.sql',
    'packages/source-github/src/generated/github-deploy-boundary.ts',
    'packages/source-github/src/generated/github-deploy.sql',
    'packages/testing/src/ledger/generated/ledger-account-boundary.ts',
    'packages/testing/src/ledger/generated/ledger-account.sql',
    'packages/source-telemetry/src/generated/telemetry-model-request-boundary.ts',
    'packages/source-telemetry/src/generated/telemetry-model-request.sql',
    'packages/source-telemetry/src/generated/telemetry-turn-cost-boundary.ts',
    'packages/source-telemetry/src/generated/telemetry-turn-cost.sql',
    'e2e/logbook-plugin/src/generated/logbook-voyage-boundary.ts',
    'e2e/logbook-plugin/src/generated/logbook-voyage.sql',
  ]);
});
