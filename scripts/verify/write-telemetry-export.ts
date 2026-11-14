import { buildLogsExport } from '@pepys/source-telemetry/test-utils/build-logs-export';
import { WringerError } from '@wringer/core';
import { e2eSecrets } from '../../packages/cli/src/test-utils/e2e-secrets.ts';
import { createControlClient } from './create-control-client.ts';
import type { RunEndpoints } from './parse-run-endpoints.ts';

interface ModelRequest {
  id: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd?: number | undefined;
  at: string;
}

interface TelemetryInput {
  session: string;
  requests: readonly ModelRequest[];
}

// The sender that proves each export: the run's identity issuer signs its token for this subject.
const sender = { subject: 'imp-verify', name: 'imp-verify' } as const;

// Sends one OTLP logs export of the Claude Code model requests of the session to ingest's telemetry
// route, with the bearer secret and a fresh identity token, as an exporter on an imp does. It
// returns the query input that names the session and its sender.
export async function writeTelemetryExport(run: RunEndpoints, input: TelemetryInput) {
  const control = createControlClient(run.control);

  const signed = await control.signIdentityToken(sender);

  const body = buildLogsExport(
    'claude_code',
    { 'atc.session.id': input.session },
    input.requests.map((request) => ({
      'event.name': 'api_request',
      'session.id': input.session,
      'event.timestamp': request.at,
      request_id: request.id,
      model: request.model,
      input_tokens: request.inputTokens,
      output_tokens: request.outputTokens,
      cache_read_tokens: request.cacheReadTokens,
      cache_creation_tokens: request.cacheCreationTokens,
      ...(request.costUsd === undefined ? {} : { cost_usd: request.costUsd }),
    })),
  );

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
