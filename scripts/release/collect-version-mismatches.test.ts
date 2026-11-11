import { expect, test } from 'bun:test';
import { collectVersionMismatches } from './collect-version-mismatches.ts';

test('it finds no mismatch when every package carries the version of the tag', () => {
  const packages = [
    { name: '@pepys/kit', version: '1.4.0' },
    { name: '@pepys/testing', version: '1.4.0' },
  ];

  expect(collectVersionMismatches(packages, 'v1.4.0')).toStrictEqual([]);
});

test('it names each package at another version than the tag', () => {
  const packages = [
    { name: '@pepys/kit', version: '1.4.0' },
    { name: '@pepys/testing', version: '1.3.2' },
  ];

  expect(collectVersionMismatches(packages, 'v1.4.0')).toStrictEqual([
    '@pepys/testing is at 1.3.2, and the tag v1.4.0 needs 1.4.0',
  ]);
});

test('it refuses a tag that does not start with v', () => {
  const packages = [{ name: '@pepys/kit', version: '1.4.0' }];

  expect(collectVersionMismatches(packages, '1.4.0')).toStrictEqual([
    'the tag 1.4.0 is not v<version>',
  ]);
});
