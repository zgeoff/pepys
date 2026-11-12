import { expect, test } from 'bun:test';
import { pickHostBinary } from './pick-host-binary.ts';

test('it returns the path in PEPYS_HOST_BIN', () => {
  expect(pickHostBinary({ PEPYS_HOST_BIN: '/opt/pepys/host' })).toStrictEqual({
    ok: true,
    value: '/opt/pepys/host',
  });
});

test.each([
  ['unset', {}],
  ['empty', { PEPYS_HOST_BIN: '' }],
])('it names the variable when it is %s', (_title, environment) => {
  expect(pickHostBinary(environment)).toStrictEqual({
    ok: false,
    failure: 'pepys start needs PEPYS_HOST_BIN, the path of the host binary',
  });
});
