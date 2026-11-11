import { expect, test } from 'bun:test';
import { collectSumsProblems } from './collect-sums-problems.ts';

test.each([
  {
    title: 'nothing for a sums file that lists the asset with its sha256',
    sumsText: `${'a'.repeat(64)}  pepys-host-linux-x64\n`,
    assetSHA256: 'a'.repeat(64),
    problems: [],
  },
  {
    title: 'nothing for a line in the binary mode of sha256sum',
    sumsText: `${'a'.repeat(64)} *pepys-host-linux-x64\n`,
    assetSHA256: 'a'.repeat(64),
    problems: [],
  },
  {
    title: 'a missing sums file',
    sumsText: null,
    assetSHA256: 'a'.repeat(64),
    problems: ['SHA256SUMS is missing'],
  },
  {
    title: 'a missing sums file and a missing asset',
    sumsText: null,
    assetSHA256: null,
    problems: ['SHA256SUMS is missing', 'pepys-host-linux-x64 is missing'],
  },
  {
    title: 'a missing asset',
    sumsText: `${'a'.repeat(64)}  pepys-host-linux-x64\n`,
    assetSHA256: null,
    problems: ['pepys-host-linux-x64 is missing'],
  },
  {
    title: 'a sha256 that differs from the asset',
    sumsText: `${'a'.repeat(64)}  pepys-host-linux-x64\n`,
    assetSHA256: 'b'.repeat(64),
    problems: [
      `SHA256SUMS gives pepys-host-linux-x64 the sha256 ${'a'.repeat(64)}, and the file has ${'b'.repeat(64)}`,
    ],
  },
  {
    title: 'a name with a folder in it',
    sumsText: `${'a'.repeat(64)}  dist/pepys-host-linux-x64\n`,
    assetSHA256: 'a'.repeat(64),
    problems: [
      'SHA256SUMS lists [dist/pepys-host-linux-x64], and needs exactly pepys-host-linux-x64',
    ],
  },
  {
    title: 'a second file in the list',
    sumsText: `${'a'.repeat(64)}  pepys-host-linux-x64\n${'b'.repeat(64)}  notes.txt\n`,
    assetSHA256: 'a'.repeat(64),
    problems: [
      'SHA256SUMS lists [pepys-host-linux-x64, notes.txt], and needs exactly pepys-host-linux-x64',
    ],
  },
  {
    title: 'a line in another format',
    sumsText: 'SHA256 (pepys-host-linux-x64) = abc\n',
    assetSHA256: 'a'.repeat(64),
    problems: [
      'SHA256SUMS has a line that is not in the sha256sum format: SHA256 (pepys-host-linux-x64) = abc',
      'SHA256SUMS lists [], and needs exactly pepys-host-linux-x64',
    ],
  },
])('it reports $title', (row) => {
  expect(collectSumsProblems(row.sumsText, row.assetSHA256)).toStrictEqual([...row.problems]);
});
