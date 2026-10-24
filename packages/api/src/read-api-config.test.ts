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

test('it names each variable that is missing or wrong', () => {
  expect(readAPIConfig({ PEPYS_API_PORT: 'harbour' })).toStrictEqual({
    ok: false,
    failure: ['PEPYS_STORE_DIR is not set', 'PEPYS_API_PORT is not a port number'],
  });
});
