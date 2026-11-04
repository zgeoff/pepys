import { buildCharsetFixtures } from './build-charset-fixtures.ts';
import { buildEverydayFixtures } from './build-everyday-fixtures.ts';
import { buildLargeFixtures } from './build-large-fixtures.ts';
import { buildMalformedFixtures } from './build-malformed-fixtures.ts';
import type { Fixture } from './types.ts';

export function buildCorpus(): Fixture[] {
  return [
    ...buildEverydayFixtures(),
    ...buildCharsetFixtures(),
    ...buildMalformedFixtures(),
    ...buildLargeFixtures(),
  ];
}
