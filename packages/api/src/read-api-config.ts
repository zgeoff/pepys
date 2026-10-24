import { parsePort } from '@pepys/schema';
import type { Result } from '@pepys/schema';

export interface APIConfig {
  storeDirectory: string;
  port: number;
}

export function readAPIConfig(
  environment: Readonly<Record<string, string | undefined>>,
): Result<APIConfig, string[]> {
  const storeDirectory = environment['PEPYS_STORE_DIR'] ?? '';
  const portText = environment['PEPYS_API_PORT'] ?? '';
  const port = portText === '' ? ({ ok: true, value: 8081 } as const) : parsePort(portText);

  const problems = [
    ...(storeDirectory === '' ? ['PEPYS_STORE_DIR is not set'] : []),
    ...(port.ok ? [] : ['PEPYS_API_PORT is not a port number']),
  ];

  if (!port.ok || problems.length > 0) {
    return { ok: false, failure: problems };
  }

  return { ok: true, value: { storeDirectory, port: port.value } };
}
