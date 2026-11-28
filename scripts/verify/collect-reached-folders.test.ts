import { expect, test } from 'bun:test';
import { collectReachedFolders } from './collect-reached-folders.ts';

test.each([
  {
    title: 'a seed with no dependencies',
    seeds: ['packages/kettle'],
    packages: [{ folder: 'packages/kettle', name: '@pepys/kettle', workspaceDependencies: [] }],
    reached: ['packages/kettle'],
  },
  {
    title: 'the dependencies of a dependency',
    seeds: ['packages/source-kettle'],
    packages: [
      {
        folder: 'packages/source-kettle',
        name: '@pepys/source-kettle',
        workspaceDependencies: ['@pepys/kettle'],
      },
      { folder: 'packages/kettle', name: '@pepys/kettle', workspaceDependencies: ['@pepys/clock'] },
      { folder: 'packages/clock', name: '@pepys/clock', workspaceDependencies: [] },
      { folder: 'packages/teapot', name: '@pepys/teapot', workspaceDependencies: [] },
    ],
    reached: ['packages/clock', 'packages/kettle', 'packages/source-kettle'],
  },
  {
    title: 'each package of a cycle once',
    seeds: ['packages/cup'],
    packages: [
      { folder: 'packages/cup', name: '@pepys/cup', workspaceDependencies: ['@pepys/saucer'] },
      { folder: 'packages/saucer', name: '@pepys/saucer', workspaceDependencies: ['@pepys/cup'] },
    ],
    reached: ['packages/cup', 'packages/saucer'],
  },
  {
    title: 'a seed folder with no package, as after its deletion',
    seeds: ['packages/gone'],
    packages: [],
    reached: ['packages/gone'],
  },
  {
    title: 'no folder for a dependency outside the workspace',
    seeds: ['packages/kettle'],
    packages: [
      {
        folder: 'packages/kettle',
        name: '@pepys/kettle',
        workspaceDependencies: ['@pepys/elsewhere'],
      },
    ],
    reached: ['packages/kettle'],
  },
])('it reaches $title', (row) => {
  expect(collectReachedFolders(row.seeds, row.packages)).toStrictEqual([...row.reached]);
});
