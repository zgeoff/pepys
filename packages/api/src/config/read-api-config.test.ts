import { expect, test } from 'bun:test';
import { readAPIConfig } from './read-api-config.ts';

test('it reads the store directory and the listen address from the environment', () => {
  const environment = {
    PEPYS_STORE_DIR: '/var/pepys',
    PEPYS_API_HOST: '0.0.0.0',
    PEPYS_API_PORT: '9191',
  };

  expect(readAPIConfig(environment)).toStrictEqual({
    ok: true,
    value: { storeDirectory: '/var/pepys', host: '0.0.0.0', port: 9191, mcp: null },
  });
});

test('it listens on 127.0.0.1 and port 8081 when neither is set', () => {
  expect(readAPIConfig({ PEPYS_STORE_DIR: '/var/pepys' })).toStrictEqual({
    ok: true,
    value: { storeDirectory: '/var/pepys', host: '127.0.0.1', port: 8081, mcp: null },
  });
});

test('it listens on 127.0.0.1 and port 8081 when both are set to an empty value', () => {
  const environment = { PEPYS_STORE_DIR: '/var/pepys', PEPYS_API_HOST: '', PEPYS_API_PORT: '' };

  expect(readAPIConfig(environment)).toStrictEqual({
    ok: true,
    value: { storeDirectory: '/var/pepys', host: '127.0.0.1', port: 8081, mcp: null },
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

test('it reads what /mcp needs once the public URL is set', () => {
  const environment = {
    PEPYS_STORE_DIR: '/var/pepys',
    PEPYS_API_PUBLIC_URL: 'https://pepys.example.com',
    PEPYS_AUTH_DIR: '/var/pepys-auth',
    PEPYS_API_ALLOWED_HOSTS: 'api.internal.example.com, api.example.com',
    PEPYS_API_TRUST_FORWARDED_FROM: '10.0.0.7',
  };

  expect(readAPIConfig(environment)).toStrictEqual({
    ok: true,
    value: {
      storeDirectory: '/var/pepys',
      host: '127.0.0.1',
      port: 8081,
      mcp: {
        publicURL: 'https://pepys.example.com',
        authDirectory: '/var/pepys-auth',
        allowedHosts: ['api.internal.example.com', 'api.example.com'],
        trustForwardedFrom: ['10.0.0.7'],
      },
    },
  });
});

test('it refuses a public URL without the folder of the OAuth database', () => {
  const environment = {
    PEPYS_STORE_DIR: '/var/pepys',
    PEPYS_API_PUBLIC_URL: 'https://pepys.example.com',
  };

  expect(readAPIConfig(environment)).toStrictEqual({
    ok: false,
    failure: ['PEPYS_AUTH_DIR is not set, and PEPYS_API_PUBLIC_URL needs it'],
  });
});
