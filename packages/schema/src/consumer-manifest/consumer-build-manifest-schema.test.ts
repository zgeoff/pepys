import { expect, test } from 'bun:test';
import { consumerBuildManifestSchema } from './consumer-build-manifest-schema.ts';
import manifestCases from './consumer-manifest-cases.json' with { type: 'json' };

// The host's manifest parser runs the same cases, so the two parsers cannot drift apart unseen.
test.each(manifestCases.cases.map((manifestCase) => [manifestCase.title, manifestCase] as const))(
  'it %s, in the shared manifest cases',
  (_title, manifestCase) => {
    const parsed = consumerBuildManifestSchema.safeParse(manifestCase.file);

    expect(parsed.success).toBe(manifestCase.isValid);
  },
);
