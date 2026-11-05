import { expect, test } from 'bun:test';
import { readAPIConfig } from './read-api-config.ts';

test('it reads the store directory and port from the environment', () => {
  expect(readAPIConfig({ PEPYS_STORE_DIR: '/var/pepys', PEPYS_API_PORT: '9191' })).toStrictEqual({
    ok: true,
    value: { storeDirectory: '/var/pepys', port: 9191 },
  });
});

test('it listens on port 8081 when no port is set', () => {
  expect(readAPIConfig({ PEPYS_STORE_DIR: '/var/pepys' })).toStrictEqual({
    ok: true,
    value: { storeDirectory: '/var/pepys', port: 8081 },
  });
});

test('it listens on port 8081 when the port is set to an empty value', () => {
  expect(readAPIConfig({ PEPYS_STORE_DIR: '/var/pepys', PEPYS_API_PORT: '' })).toStrictEqual({
    ok: true,
    value: { storeDirectory: '/var/pepys', port: 8081 },
  });
});

test.each([
  ['port zero', '0'],
  ['a port above 65535', '65536'],
  ['exponent notation', '1e3'],
  ['a hexadecimal number', '0x50'],
])('it refuses %s as the port', (_label, portText) => {
  expect(readAPIConfig({ PEPYS_STORE_DIR: '/var/pepys', PEPYS_API_PORT: portText })).toStrictEqual({
    ok: false,
    failure: ['PEPYS_API_PORT is not a port number'],
  });
});

test('it names each variable that is missing or wrong', () => {
  expect(readAPIConfig({ PEPYS_API_PORT: 'harbour' })).toStrictEqual({
    ok: false,
    failure: ['PEPYS_STORE_DIR is not set', 'PEPYS_API_PORT is not a port number'],
  });
});
