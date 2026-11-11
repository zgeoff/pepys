import { expect, test } from 'bun:test';
import { pickAbandonedFolders } from './pick-abandoned-folders.ts';

test('it picks each folder whose owner process is gone', () => {
  expect(
    pickAbandonedFolders([
      { name: 'pid4182-ns4026531836-ledger-a1b2c3', owner: 'gone' },
      { name: 'pid77-ns4026531836-notes-x9y8z7', owner: 'running' },
      { name: 'pid91-ns4026531836-drafts-k4l5m6', owner: 'gone' },
    ]),
  ).toStrictEqual(['pid4182-ns4026531836-ledger-a1b2c3', 'pid91-ns4026531836-drafts-k4l5m6']);
});

test('it picks no folder whose owner process still runs', () => {
  expect(
    pickAbandonedFolders([{ name: 'pid77-ns4026531836-notes-x9y8z7', owner: 'running' }]),
  ).toStrictEqual([]);
});

test('it picks nothing from no folders', () => {
  expect(pickAbandonedFolders([])).toStrictEqual([]);
});
