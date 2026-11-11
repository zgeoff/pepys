import { expect, test } from 'bun:test';
import { readIngestConfig } from './read-ingest-config.ts';

test('it reads the listen address, the log and each secret from the environment', () => {
  const environment = {
    PEPYS_INGEST_HOST: '0.0.0.0',
    PEPYS_INGEST_PORT: '9090',
    PEPYS_S2_ENDPOINT: 'http://127.0.0.1:18431',
    PEPYS_S2_ACCESS_TOKEN: 'ignored',
    PEPYS_S2_BASIN: 'pepys',
    LEDGER_SECRET: 'till-secret',
  };

  expect(readIngestConfig(environment, ['LEDGER_SECRET'])).toStrictEqual({
    ok: true,
    value: {
      host: '0.0.0.0',
      port: 9090,
      s2: { endpoint: 'http://127.0.0.1:18431', accessToken: 'ignored', basin: 'pepys' },
      secrets: { LEDGER_SECRET: 'till-secret' },
    },
  });
});

test('it listens on 127.0.0.1 and port 8080 when neither is set', () => {
  const environment = {
    PEPYS_S2_ENDPOINT: 'http://127.0.0.1:18431',
    PEPYS_S2_ACCESS_TOKEN: 'ignored',
    PEPYS_S2_BASIN: 'pepys',
  };

  const config = readIngestConfig(environment, []);

  expect(config).toStrictEqual({
    ok: true,
    value: expect.objectContaining({ host: '127.0.0.1', port: 8080 }),
  });
});

test('it names each variable that is missing or empty, the secrets included', () => {
  const environment = { PEPYS_S2_BASIN: 'pepys', LEDGER_SECRET: '' };

  expect(readIngestConfig(environment, ['LEDGER_SECRET', 'BEACON_TOKEN'])).toStrictEqual({
    ok: false,
    failure: [
      'PEPYS_S2_ENDPOINT is not set',
      'PEPYS_S2_ACCESS_TOKEN is not set',
      'LEDGER_SECRET is not set',
      'BEACON_TOKEN is not set',
    ],
  });
});

test('it refuses a port that is not a number', () => {
  const environment = {
    PEPYS_INGEST_PORT: 'harbour',
    PEPYS_S2_ENDPOINT: 'http://127.0.0.1:18431',
    PEPYS_S2_ACCESS_TOKEN: 'ignored',
    PEPYS_S2_BASIN: 'pepys',
  };

  expect(readIngestConfig(environment, [])).toStrictEqual({
    ok: false,
    failure: ['PEPYS_INGEST_PORT is not a port number'],
  });
});
