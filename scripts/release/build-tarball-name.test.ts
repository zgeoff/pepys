import { expect, test } from 'bun:test';
import { buildTarballName } from './build-tarball-name.ts';

test('it names the tarball of a scoped package without the @ and with - for the /', () => {
  expect(buildTarballName({ name: '@pepys/lantern', version: '2.1.0' })).toBe(
    'pepys-lantern-2.1.0.tgz',
  );
});
