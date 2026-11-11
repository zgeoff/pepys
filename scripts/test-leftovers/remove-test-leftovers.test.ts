import { expect, mock, test } from 'bun:test';
import { removeTestLeftovers } from './remove-test-leftovers.ts';

test('it removes a folder of this namespace whose process no longer runs', async () => {
  const removeFolder = mock(() => Promise.resolve());

  await removeTestLeftovers({
    directory: '/scratch',
    readLink: () => Promise.resolve('pid:[4026531836]'),
    readDirectory: () => Promise.resolve(['pid4182-ns4026531836-ledger-a1b2c3']),
    removeFolder,
    signalProcess: () => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    },
  });

  expect(removeFolder).toHaveBeenCalledExactlyOnceWith(
    '/scratch/pid4182-ns4026531836-ledger-a1b2c3',
  );
});

test('it never removes the files of a run that is still going', async () => {
  const removeFolder = mock(() => Promise.resolve());

  await removeTestLeftovers({
    directory: '/scratch',
    readLink: () => Promise.resolve('pid:[4026531836]'),
    readDirectory: () => Promise.resolve(['pid4182-ns4026531836-ledger-a1b2c3']),
    removeFolder,
    signalProcess: () => true,
  });

  expect(removeFolder).not.toHaveBeenCalled();
});

test.each([
  { code: 'EPERM', reason: "another user's process" },
  { code: 'EINVAL', reason: 'an unexpected signal error' },
])('it keeps a folder whose process check fails with $code, $reason', async (row) => {
  const removeFolder = mock(() => Promise.resolve());

  await removeTestLeftovers({
    directory: '/scratch',
    readLink: () => Promise.resolve('pid:[4026531836]'),
    readDirectory: () => Promise.resolve(['pid4182-ns4026531836-ledger-a1b2c3']),
    removeFolder,
    signalProcess: () => {
      throw Object.assign(new Error(row.reason), { code: row.code });
    },
  });

  expect(removeFolder).not.toHaveBeenCalled();
});

test.each([
  { kind: 'a folder of another namespace', names: ['pid4182-ns4026532999-ledger-a1b2c3'] },
  { kind: 'a folder with no run prefix', names: ['ledger-a1b2c3'] },
  { kind: 'an empty temp folder', names: [] },
])('it removes nothing from $kind', async (row) => {
  const removeFolder = mock(() => Promise.resolve());

  await removeTestLeftovers({
    directory: '/scratch',
    readLink: () => Promise.resolve('pid:[4026531836]'),
    readDirectory: () => Promise.resolve(row.names),
    removeFolder,
    signalProcess: () => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    },
  });

  expect(removeFolder).not.toHaveBeenCalled();
});

test('it removes nothing on a host with no PID namespace', async () => {
  const removeFolder = mock(() => Promise.resolve());

  await removeTestLeftovers({
    directory: '/scratch',
    readLink: () => Promise.reject(Object.assign(new Error('no such file'), { code: 'ENOENT' })),
    readDirectory: () => Promise.resolve(['pid4182-nsnone-ledger-a1b2c3']),
    removeFolder,
    signalProcess: () => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' });
    },
  });

  expect(removeFolder).not.toHaveBeenCalled();
});
