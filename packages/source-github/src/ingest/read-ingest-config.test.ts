import { expect, test } from 'bun:test';
import { readIngestConfig } from './read-ingest-config.ts';

test('it reads the configuration from the environment', () => {
  const environment = {
    PEPYS_INGEST_PORT: '9090',
    PEPYS_GITHUB_WEBHOOK_SECRET: 'fixture-secret',
    PEPYS_S2_ENDPOINT: 'http://127.0.0.1:18431',
    PEPYS_S2_ACCESS_TOKEN: 'ignored',
    PEPYS_S2_BASIN: 'pepys',
  };

  expect(readIngestConfig(environment)).toStrictEqual({
    ok: true,
    value: {
      port: 9090,
      webhookSecret: 'fixture-secret',
      s2Endpoint: 'http://127.0.0.1:18431',
      s2AccessToken: 'ignored',
      s2Basin: 'pepys',
    },
  });
});

test('it listens on port 8080 when no port is set', () => {
  const environment = {
    PEPYS_GITHUB_WEBHOOK_SECRET: 'fixture-secret',
    PEPYS_S2_ENDPOINT: 'http://127.0.0.1:18431',
    PEPYS_S2_ACCESS_TOKEN: 'ignored',
    PEPYS_S2_BASIN: 'pepys',
  };

  const config = readIngestConfig(environment);

  expect(config.ok && config.value.port).toBe(8080);
});

test('it names each variable that is missing', () => {
  expect(readIngestConfig({ PEPYS_S2_BASIN: 'pepys' })).toStrictEqual({
    ok: false,
    failure: [
      'PEPYS_GITHUB_WEBHOOK_SECRET is not set',
      'PEPYS_S2_ENDPOINT is not set',
      'PEPYS_S2_ACCESS_TOKEN is not set',
    ],
  });
});

test('it refuses a port that is not a number', () => {
  const environment = {
    PEPYS_INGEST_PORT: 'eighty',
    PEPYS_GITHUB_WEBHOOK_SECRET: 'fixture-secret',
    PEPYS_S2_ENDPOINT: 'http://127.0.0.1:18431',
    PEPYS_S2_ACCESS_TOKEN: 'ignored',
    PEPYS_S2_BASIN: 'pepys',
  };

  expect(readIngestConfig(environment)).toStrictEqual({
    ok: false,
    failure: ['PEPYS_INGEST_PORT is not a port number'],
  });
});
