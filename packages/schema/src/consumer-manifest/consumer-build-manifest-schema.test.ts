import { expect, test } from 'bun:test';
import invariant from 'tiny-invariant';
import { consumerBuildManifestSchema } from './consumer-build-manifest-schema.ts';
import manifestCases from './consumer-manifest-cases.json' with { type: 'json' };

// The host's manifest parser runs the same cases, so the two parsers cannot drift apart unseen. Only
// this test checks the issue path of a refused case: the host's parser names no field.
test.each(
  manifestCases.cases
    .filter((manifestCase) => manifestCase.isValid)
    .map((manifestCase) => [manifestCase.title, manifestCase] as const),
)('it %s, in the shared manifest cases', (_title, manifestCase) => {
  const parsed = consumerBuildManifestSchema.safeParse(manifestCase.file);

  expect(parsed.success).toBe(true);
});

test.each(
  manifestCases.cases
    .filter((manifestCase) => !manifestCase.isValid)
    .map((manifestCase) => [manifestCase.title, manifestCase] as const),
)('it %s, at its issue path, in the shared manifest cases', (_title, manifestCase) => {
  const parsed = consumerBuildManifestSchema.safeParse(manifestCase.file);

  invariant(!parsed.success);
  invariant(manifestCase.issuePath !== undefined);

  expect(parsed.error.issues.map((issue) => issue.path)).toStrictEqual(
    parsed.error.issues.map(() => manifestCase.issuePath),
  );
});
