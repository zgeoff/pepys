interface DeploymentEnvironmentParameters {
  // the variables of the e2e stack: the s2-lite and Garage addresses, and the consumers file
  base: Readonly<Record<string, string | undefined>>;
  hostBinary: string;
  ingestPort: number;
  apiPort: number;
  storeDirectory: string;
}

// The environment that `pepys start` gives the e2e deployment, with a made-up secret for each route
// that the deployment names.
export function buildDeploymentEnvironment(
  parameters: DeploymentEnvironmentParameters,
): Record<string, string | undefined> {
  return {
    ...parameters.base,
    PEPYS_HOST_BIN: parameters.hostBinary,
    PEPYS_INGEST_PORT: String(parameters.ingestPort),
    PEPYS_API_PORT: String(parameters.apiPort),
    PEPYS_STORE_DIR: parameters.storeDirectory,
    PEPYS_GITHUB_WEBHOOK_SECRET: 'start-webhook-secret',
    PEPYS_GITHUB_APP_ID: '1',
    PEPYS_GITHUB_APP_PRIVATE_KEY: 'unused',
    PEPYS_TELEMETRY_TOKEN: 'start-telemetry-token',
    LOGBOOK_SECRET: 'start-logbook-secret',
    LEDGER_SECRET: 'start-ledger-secret',
  };
}
