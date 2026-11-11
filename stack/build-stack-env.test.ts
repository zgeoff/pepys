import { expect, test } from 'bun:test';
import { buildStackEnv } from './build-stack-env.ts';

test('it gives each address and key of the stack its variable', () => {
  const env = buildStackEnv({
    s2Endpoint: 'http://127.0.0.1:4100',
    s2AccessToken: 'ignored',
    s2Basin: 'pepys-local',
    garage: {
      endpoint: 'http://127.0.0.1:4200',
      region: 'garage',
      blobsBucket: 'blobs',
      accessKeyID: 'GK111111111111111111111111',
      secretAccessKey: 'a-local-secret',
    },
    stop: new AbortController().signal,
  });

  expect(env).toStrictEqual({
    PEPYS_S2_ENDPOINT: 'http://127.0.0.1:4100',
    PEPYS_S2_ACCESS_TOKEN: 'ignored',
    PEPYS_S2_BASIN: 'pepys-local',
    PEPYS_GARAGE_ENDPOINT: 'http://127.0.0.1:4200',
    PEPYS_GARAGE_REGION: 'garage',
    PEPYS_GARAGE_BUCKET: 'blobs',
    PEPYS_GARAGE_ACCESS_KEY_ID: 'GK111111111111111111111111',
    PEPYS_GARAGE_SECRET_ACCESS_KEY: 'a-local-secret',
  });
});
