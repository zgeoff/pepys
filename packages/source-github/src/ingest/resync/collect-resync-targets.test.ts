import { expect, test } from 'bun:test';
import type { EntityID } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { collectResyncTargets } from './collect-resync-targets.ts';

test.each([
  {
    row: 'a pull request',
    entity: 'github:pull_request:77',
    locator: '/repos/acme/harbour/pulls/3',
    targets: [
      {
        kind: 'pull_request',
        entity: 'github:pull_request:77',
        repository: 'acme/harbour',
        path: '/repos/acme/harbour/pulls/3',
      },
    ],
  },
  {
    row: 'a release',
    entity: 'github:release:5',
    locator: '/repos/acme/harbour/releases/5',
    targets: [
      {
        kind: 'release',
        entity: 'github:release:5',
        repository: 'acme/harbour',
        path: '/repos/acme/harbour/releases/5',
      },
    ],
  },
  { row: 'a mark with no locator', entity: 'github:release:5', locator: undefined, targets: [] },
  {
    row: 'a ref',
    entity: 'github:ref:902:refs/heads/main',
    locator: '/repos/acme/harbour/git/refs/heads/main',
    targets: [],
  },
  {
    row: 'a locator of another kind than the entity',
    entity: 'github:release:5',
    locator: '/repos/acme/harbour/pulls/3',
    targets: [],
  },
])('it gives the target of $row', (row) => {
  const targets: unknown = collectResyncTargets([
    { entity: toTagged<EntityID>(row.entity), locator: row.locator },
  ]);

  expect(targets).toStrictEqual(row.targets);
});
