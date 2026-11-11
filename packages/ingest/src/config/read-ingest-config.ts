import type { Result } from '@pepys/kit';
import { parsePort } from '@pepys/schema';

export interface IngestConfig {
  // the listen address; 127.0.0.1 unless the deployment sets another
  host: string;
  port: number;
  s2: { endpoint: string; accessToken: string; basin: string };

  // one value per name the deployment's paths read, each set and not empty
  secrets: Readonly<Record<string, string>>;
}

const s2Names = ['PEPYS_S2_ENDPOINT', 'PEPYS_S2_ACCESS_TOKEN', 'PEPYS_S2_BASIN'] as const;

// Reads every variable once and names each one that is missing, so ingest stops at start with the
// whole list and never serves a route with an empty secret.
export function readIngestConfig(
  environment: Readonly<Record<string, string | undefined>>,
  secretNames: readonly string[],
): Result<IngestConfig, string[]> {
  const required = [...s2Names, ...secretNames];
  const missing = required.filter((name) => (environment[name] ?? '') === '');
  const portText = environment['PEPYS_INGEST_PORT'] ?? '';
  const port = portText === '' ? ({ ok: true, value: 8080 } as const) : parsePort(portText);
  const host = environment['PEPYS_INGEST_HOST'] ?? '';

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
      host: host === '' ? '127.0.0.1' : host,
      port: port.value,
      s2: {
        endpoint: environment['PEPYS_S2_ENDPOINT'] ?? '',
        accessToken: environment['PEPYS_S2_ACCESS_TOKEN'] ?? '',
        basin: environment['PEPYS_S2_BASIN'] ?? '',
      },
      secrets: Object.fromEntries(secretNames.map((name) => [name, environment[name] ?? ''])),
    },
  };
}
