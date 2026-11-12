import { expect, test } from 'bun:test';
import { buildDeploymentEnvironment } from './build-deployment-environment.ts';

test('it adds the ports, the store and the secrets to the base environment', () => {
  const environment = buildDeploymentEnvironment({
    base: { PEPYS_S2_BASIN: 'harbour' },
    hostBinary: '/opt/pepys/host',
    ingestPort: 8080,
    apiPort: 8081,
    storeDirectory: '/var/pepys',
  });

  expect(environment).toStrictEqual({
    PEPYS_S2_BASIN: 'harbour',
    PEPYS_HOST_BIN: '/opt/pepys/host',
    PEPYS_INGEST_PORT: '8080',
    PEPYS_API_PORT: '8081',
    PEPYS_STORE_DIR: '/var/pepys',
    PEPYS_GITHUB_WEBHOOK_SECRET: 'start-webhook-secret',
    PEPYS_GITHUB_APP_ID: '1',
    PEPYS_GITHUB_APP_PRIVATE_KEY: 'unused',
    PEPYS_TELEMETRY_TOKEN: 'start-telemetry-token',
    LOGBOOK_SECRET: 'start-logbook-secret',
    LEDGER_SECRET: 'start-ledger-secret',
  });
});
