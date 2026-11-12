import type { Result } from '@pepys/kit';
import { parsePort } from '@pepys/schema';

// What /mcp and its OAuth server need; the API serves /rpc alone without it.
export interface MCPConfig {
  // the origin clients reach the API at, through the TLS tunnel in front of it
  publicURL: string;

  // the folder that holds the OAuth server's database
  authDirectory: string;

  // further Host header values to accept, for a proxy that rewrites Host
  allowedHosts: string[];

  // the socket peers whose CF-Connecting-IP header a security event marks trusted
  trustForwardedFrom: string[];
}

export interface APIConfig {
  storeDirectory: string;

  // the listen address; 127.0.0.1 unless the deployment sets another
  host: string;
  port: number;

  // null when PEPYS_API_PUBLIC_URL is unset
  mcp: MCPConfig | null;
}

export function readAPIConfig(
  environment: Readonly<Record<string, string | undefined>>,
): Result<APIConfig, string[]> {
  const storeDirectory = environment['PEPYS_STORE_DIR'] ?? '';
  const host = environment['PEPYS_API_HOST'] ?? '';
  const portText = environment['PEPYS_API_PORT'] ?? '';
  const port = portText === '' ? ({ ok: true, value: 8081 } as const) : parsePort(portText);
  const publicURL = environment['PEPYS_API_PUBLIC_URL'] ?? '';
  const authDirectory = environment['PEPYS_AUTH_DIR'] ?? '';

  const problems = [
    ...(storeDirectory === '' ? ['PEPYS_STORE_DIR is not set'] : []),
    ...(port.ok ? [] : ['PEPYS_API_PORT is not a port number']),
    ...(publicURL !== '' && authDirectory === ''
      ? ['PEPYS_AUTH_DIR is not set, and PEPYS_API_PUBLIC_URL needs it']
      : []),
  ];

  if (!port.ok || problems.length > 0) {
    return { ok: false, failure: problems };
  }

  return {
    ok: true,
    value: {
      storeDirectory,
      host: host === '' ? '127.0.0.1' : host,
      port: port.value,
      mcp:
        publicURL === ''
          ? null
          : {
              publicURL,
              authDirectory,
              allowedHosts: parseList(environment['PEPYS_API_ALLOWED_HOSTS']),
              trustForwardedFrom: parseList(environment['PEPYS_API_TRUST_FORWARDED_FROM']),
            },
    },
  };
}

// A comma-separated list, with the space around each entry dropped.
function parseList(text: string | undefined): string[] {
  return (text ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}
