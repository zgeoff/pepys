import { expect, test } from 'bun:test';
import { collectOwnedFolders } from './collect-owned-folders.ts';

test('it collects each folder of the namespace with the PID that made it', () => {
  expect(
    collectOwnedFolders(
      ['pid4182-ns4026531836-ledger-a1b2c3', 'pid77-ns4026531836-notes-x9y8z7'],
      '4026531836',
    ),
  ).toStrictEqual([
    { name: 'pid4182-ns4026531836-ledger-a1b2c3', pid: 4182 },
    { name: 'pid77-ns4026531836-notes-x9y8z7', pid: 77 },
  ]);
});

test.each([
  { kind: 'a folder of another namespace', name: 'pid4182-ns4026532999-ledger-a1b2c3' },
  { kind: 'a folder with no run prefix', name: 'ledger-a1b2c3' },
  { kind: 'a folder whose prefix sits mid-name', name: 'old-pid4182-ns4026531836-ledger' },
])('it leaves out $kind', (row) => {
  expect(collectOwnedFolders([row.name], '4026531836')).toStrictEqual([]);
});

test('it collects nothing for a run with no PID namespace', () => {
  expect(collectOwnedFolders(['pid4182-nsnone-ledger-a1b2c3'], 'none')).toStrictEqual([]);
});
