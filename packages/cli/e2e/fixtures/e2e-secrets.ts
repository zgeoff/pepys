// The invented secrets of the e2e deployment: the GitHub webhook secret, the bearer secrets of the
// telemetry and plug-in routes, and the audience and issuer of the identity tokens ingest trusts.
export const e2eSecrets = {
  githubWebhook: 'github-pr-webhook-secret',
  logbook: 'logbook-e2e-secret',
  ledger: 'ledger-e2e-secret',
  telemetry: 'telemetry-e2e-token',
  identityAudience: 'pepys-ingest-e2e',
  identityIssuer: 'harbour-broker',
} as const;
