import { expect, test } from 'bun:test';
import { pickPublishStep } from './pick-publish-step.ts';
import type { PublishStep } from './pick-publish-step.ts';

test.each<[string, boolean, PublishStep]>([
  [
    'skips a version npm has',
    true,
    { kind: 'skip', message: '@pepys/kit@0.4.2 is on npm already' },
  ],
  [
    'publishes the packed tarball of a version npm lacks',
    false,
    { kind: 'publish', tarball: '/packs/pepys-kit-0.4.2.tgz' },
  ],
])('it %s', (_title, isPublished, expected) => {
  const step = pickPublishStep({
    pkg: { name: '@pepys/kit', version: '0.4.2', folder: '/repo/packages/kit', entries: [] },
    isPublished,
    packDirectory: '/packs',
  });

  expect(step).toStrictEqual(expected);
});
