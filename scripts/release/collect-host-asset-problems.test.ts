import { expect, test } from 'bun:test';
import { collectHostAssetProblems } from './collect-host-asset-problems.ts';
import type { HostAssetInput } from './collect-host-asset-problems.ts';

test.each<[string, HostAssetInput, string[]]>([
  [
    'nothing for an asset that matches its binary and sums, and starts',
    {
      sumsText: `${'a'.repeat(64)}  pepys-host-linux-x64\n`,
      asset: {
        sha256: 'a'.repeat(64),
        binarySHA256: 'a'.repeat(64),
        binary: '/build/pepys',
        symbolTable: '0000 DF *UND* 0000 (GLIBC_2.35) __libc_start_main\n',
        helpExitCode: 0,
      },
    },
    [],
  ],
  [
    'the missing asset',
    { sumsText: `${'a'.repeat(64)}  pepys-host-linux-x64\n`, asset: null },
    ['pepys-host-linux-x64 is missing'],
  ],
  [
    'the missing sums file',
    {
      sumsText: null,
      asset: {
        sha256: 'a'.repeat(64),
        binarySHA256: 'a'.repeat(64),
        binary: '/build/pepys',
        symbolTable: '0000 DF *UND* 0000 (GLIBC_2.35) __libc_start_main\n',
        helpExitCode: 0,
      },
    },
    ['SHA256SUMS is missing'],
  ],
  [
    'an asset that is not the built binary',
    {
      sumsText: `${'a'.repeat(64)}  pepys-host-linux-x64\n`,
      asset: {
        sha256: 'a'.repeat(64),
        binarySHA256: 'b'.repeat(64),
        binary: '/build/pepys',
        symbolTable: '0000 DF *UND* 0000 (GLIBC_2.35) __libc_start_main\n',
        helpExitCode: 0,
      },
    },
    ['pepys-host-linux-x64 is not the binary at /build/pepys'],
  ],
  [
    'an asset that needs a glibc newer than the floor',
    {
      sumsText: `${'a'.repeat(64)}  pepys-host-linux-x64\n`,
      asset: {
        sha256: 'a'.repeat(64),
        binarySHA256: 'a'.repeat(64),
        binary: '/build/pepys',
        symbolTable: '0000 DF *UND* 0000 (GLIBC_2.38) __isoc23_strtol\n',
        helpExitCode: 0,
      },
    },
    ['pepys-host-linux-x64 needs glibc 2.38, newer than 2.35'],
  ],
  [
    'an asset that does not start',
    {
      sumsText: `${'a'.repeat(64)}  pepys-host-linux-x64\n`,
      asset: {
        sha256: 'a'.repeat(64),
        binarySHA256: 'a'.repeat(64),
        binary: '/build/pepys',
        symbolTable: '0000 DF *UND* 0000 (GLIBC_2.35) __libc_start_main\n',
        helpExitCode: 127,
      },
    },
    ['pepys-host-linux-x64 --help exited with 127'],
  ],
  [
    'each problem of an asset that fails every check, the sums problem first',
    {
      sumsText: null,
      asset: {
        sha256: 'a'.repeat(64),
        binarySHA256: 'b'.repeat(64),
        binary: '/build/pepys',
        symbolTable: '0000 DF *UND* 0000 (GLIBC_2.38) __isoc23_strtol\n',
        helpExitCode: 1,
      },
    },
    [
      'SHA256SUMS is missing',
      'pepys-host-linux-x64 is not the binary at /build/pepys',
      'pepys-host-linux-x64 needs glibc 2.38, newer than 2.35',
      'pepys-host-linux-x64 --help exited with 1',
    ],
  ],
])('it gives %s', (_title, input, expected) => {
  expect(collectHostAssetProblems(input)).toStrictEqual(expected);
});
