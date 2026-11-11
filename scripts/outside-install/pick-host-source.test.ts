import { expect, test } from 'bun:test';
import { pickHostSource } from './pick-host-source.ts';

test.each([
  { binary: undefined, tag: undefined },
  { binary: '', tag: '' },
])('it picks the local debug build with the binary $binary and the tag $tag', (variables) => {
  const source = pickHostSource({ ...variables, localBuild: '/repo/target/debug/pepys' });

  expect(source).toStrictEqual({ kind: 'local', binary: '/repo/target/debug/pepys' });
});

test('it picks the binary at the given path over the local debug build', () => {
  const source = pickHostSource({
    binary: '/builds/pepys-release',
    tag: undefined,
    localBuild: '/repo/target/debug/pepys',
  });

  expect(source).toStrictEqual({ kind: 'local', binary: '/builds/pepys-release' });
});

test('it picks the host asset and the sums file of a release tag', () => {
  const source = pickHostSource({
    binary: undefined,
    tag: 'v0.3.1',
    localBuild: '/repo/target/debug/pepys',
  });

  expect(source).toStrictEqual({
    kind: 'release',
    tag: 'v0.3.1',
    assetURL: 'https://github.com/zgeoff/pepys/releases/download/v0.3.1/pepys-host-linux-x64',
    sumsURL: 'https://github.com/zgeoff/pepys/releases/download/v0.3.1/SHA256SUMS',
  });
});

test('it reports a conflict when both a binary and a tag are set', () => {
  const source = pickHostSource({
    binary: '/builds/pepys-release',
    tag: 'v0.3.1',
    localBuild: '/repo/target/debug/pepys',
  });

  expect(source).toStrictEqual({ kind: 'conflict' });
});
