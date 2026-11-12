import { expect, test } from 'bun:test';
import { pickOutsideSource } from './pick-outside-source.ts';
import type { OutsideSourceInput, OutsideSourceStep } from './pick-outside-source.ts';

test.each<[string, Omit<OutsideSourceInput, 'packages'>, OutsideSourceStep]>([
  [
    'a fresh pack with neither variable set',
    { version: undefined, packDirectory: undefined },
    { kind: 'pack' },
  ],
  ['a fresh pack with both variables empty', { version: '', packDirectory: '' }, { kind: 'pack' }],
  [
    'npm at the version with only a version set',
    { version: '0.4.2', packDirectory: undefined },
    { kind: 'npm', version: '0.4.2' },
  ],
  [
    'npm at the version over a pack folder',
    { version: '0.4.2', packDirectory: '/packs' },
    { kind: 'npm', version: '0.4.2' },
  ],
  [
    'the tarballs of a pack folder with the version empty',
    { version: '', packDirectory: '/packs' },
    {
      kind: 'tarballs',
      tarballs: {
        '@pepys/kit': '/packs/pepys-kit-0.4.2.tgz',
        '@pepys/schema': '/packs/pepys-schema-0.4.2.tgz',
      },
    },
  ],
])('it picks %s', (_title, variables, expected) => {
  const step = pickOutsideSource({
    ...variables,
    packages: [
      { name: '@pepys/kit', version: '0.4.2', folder: '/repo/packages/kit', entries: [] },
      { name: '@pepys/schema', version: '0.4.2', folder: '/repo/packages/schema', entries: [] },
    ],
  });

  expect(step).toStrictEqual(expected);
});
