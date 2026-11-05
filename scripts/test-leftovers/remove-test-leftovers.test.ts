import { expect, test } from 'bun:test';
import { removeTestLeftovers } from './remove-test-leftovers.ts';

function setupTest() {
  const removed: string[] = [];

  return {
    removed,
    removeFolder: (path: string) => {
      removed.push(path);

      return Promise.resolve();
    },
  };
}

test('it removes a folder of this namespace whose process no longer runs', async () => {
  const ctx = setupTest();

  await removeTestLeftovers({
    directory: '/scratch',
    readLink: () => Promise.resolve('pid:[4026531836]'),
    readDirectory: () => Promise.resolve(['pid4182-ns4026531836-ledger-a1b2c3']),
    removeFolder: ctx.removeFolder,
    signalProcess: () => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    },
  });

  expect(ctx.removed).toStrictEqual(['/scratch/pid4182-ns4026531836-ledger-a1b2c3']);
});

test('it never removes the files of a run that is still going', async () => {
  const ctx = setupTest();

  await removeTestLeftovers({
    directory: '/scratch',
    readLink: () => Promise.resolve('pid:[4026531836]'),
    readDirectory: () => Promise.resolve(['pid4182-ns4026531836-ledger-a1b2c3']),
    removeFolder: ctx.removeFolder,
    signalProcess: () => true,
  });

  expect(ctx.removed).toStrictEqual([]);
});

test.each([
  { code: 'EPERM', reason: "another user's process" },
  { code: 'EINVAL', reason: 'an unexpected signal error' },
])('it keeps a folder whose process check fails with $code, $reason', async (row) => {
  const ctx = setupTest();

  await removeTestLeftovers({
    directory: '/scratch',
    readLink: () => Promise.resolve('pid:[4026531836]'),
    readDirectory: () => Promise.resolve(['pid4182-ns4026531836-ledger-a1b2c3']),
    removeFolder: ctx.removeFolder,
    signalProcess: () => {
      throw Object.assign(new Error(row.reason), { code: row.code });
    },
  });

  expect(ctx.removed).toStrictEqual([]);
});

test.each([
  { kind: 'a folder of another namespace', names: ['pid4182-ns4026532999-ledger-a1b2c3'] },
  { kind: 'a folder with no run prefix', names: ['ledger-a1b2c3'] },
  { kind: 'an empty temp folder', names: [] },
])('it removes nothing from $kind', async (row) => {
  const ctx = setupTest();

  await removeTestLeftovers({
    directory: '/scratch',
    readLink: () => Promise.resolve('pid:[4026531836]'),
    readDirectory: () => Promise.resolve(row.names),
    removeFolder: ctx.removeFolder,
    signalProcess: () => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    },
  });

  expect(ctx.removed).toStrictEqual([]);
});

test('it removes nothing on a host with no PID namespace', async () => {
  const ctx = setupTest();

  await removeTestLeftovers({
    directory: '/scratch',
    readLink: () => Promise.reject(Object.assign(new Error('no such file'), { code: 'ENOENT' })),
    readDirectory: () => Promise.resolve(['pid4182-nsnone-ledger-a1b2c3']),
    removeFolder: ctx.removeFolder,
    signalProcess: () => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    },
  });

  expect(ctx.removed).toStrictEqual([]);
});
