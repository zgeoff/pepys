import { parsePort } from '@pepys/schema';
import type { Result } from '@pepys/schema';

export interface IngestConfig {
  port: number;
  webhookSecret: string;
  s2Endpoint: string;
  s2AccessToken: string;
  s2Basin: string;
}

const requiredNames = [
  'PEPYS_GITHUB_WEBHOOK_SECRET',
  'PEPYS_S2_ENDPOINT',
  'PEPYS_S2_ACCESS_TOKEN',
  'PEPYS_S2_BASIN',
] as const;

export function readIngestConfig(
  environment: Readonly<Record<string, string | undefined>>,
): Result<IngestConfig, string[]> {
  const missing = requiredNames.filter((name) => (environment[name] ?? '') === '');
  const portText = environment['PEPYS_INGEST_PORT'] ?? '';
  const port = portText === '' ? ({ ok: true, value: 8080 } as const) : parsePort(portText);

  const problems = [
    ...missing.map((name) => `${name} is not set`),
    ...(port.ok ? [] : ['PEPYS_INGEST_PORT is not a port number']),
  ];

  if (!port.ok || problems.length > 0) {
    return { ok: false, failure: problems };
  }

  return {
    ok: true,
    value: {
      port: port.value,
      webhookSecret: environment['PEPYS_GITHUB_WEBHOOK_SECRET'] ?? '',
      s2Endpoint: environment['PEPYS_S2_ENDPOINT'] ?? '',
      s2AccessToken: environment['PEPYS_S2_ACCESS_TOKEN'] ?? '',
      s2Basin: environment['PEPYS_S2_BASIN'] ?? '',
    },
  };
}
