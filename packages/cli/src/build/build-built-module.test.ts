import { expect, test } from 'bun:test';
import type { VersionHash } from '@pepys/kit';
import { toTagged } from '@zgeoff/std';
import { buildBuiltModule } from './build-built-module.ts';

test.each([
  [
    'no bytes',
    new Uint8Array(),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ],
  [
    'the bytes of abc',
    new TextEncoder().encode('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  ],
])('it names the module of %s by its sha256', (_title, bytes, sha256) => {
  expect(buildBuiltModule('tide_log', bytes)).toStrictEqual({
    name: 'tide_log',
    module: toTagged<VersionHash>(sha256),
    path: `tide_log/${sha256}.wasm`,
  });
});
