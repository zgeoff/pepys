import { WringerError } from '@wringer/core';
import { e2eSecrets } from '../../packages/cli/e2e/fixtures/e2e-secrets.ts';
import { buildTelemetryExport } from './build-telemetry-export.ts';
import type { ModelRequest } from './build-telemetry-export.ts';
import { createControlClient } from './create-control-client.ts';
import type { RunEndpoints } from './parse-run-endpoints.ts';

interface TelemetryInput {
  session: string;
  requests: readonly ModelRequest[];
}

// The sender that proves each export: the run's identity issuer signs its token for this subject.
const sender = { subject: 'verify-agent', name: 'verify-agent' } as const;

// Sends one OTLP logs export of the session's model requests to ingest's telemetry route, with the
// bearer secret and a fresh identity token, and returns the query input that names the session and
// its sender.
export async function writeTelemetryExport(run: RunEndpoints, input: TelemetryInput) {
  const control = createControlClient(run.control);

  const signed = await control.signIdentityToken(sender);

  const body = buildTelemetryExport(input.session, input.requests);

  const response = await fetch(new URL('/v1/logs', run.ingest), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${e2eSecrets.telemetry}`,
      'imp-identity': signed.token,
    },
    body: JSON.stringify(body),
  });

  if (response.status !== 200) {
    throw new WringerError('check-failed', {
      message: `ingest answered ${response.status} to the logs export: ${await response.text()}`,
    });
  }

  return {
    session: `telemetry:session:${input.session}`,
    issuer: e2eSecrets.identityIssuer,
    subject: sender.subject,
  };
}
