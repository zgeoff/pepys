import type { Result } from '@pepys/schema';

export interface APIConfig {
  storeDirectory: string;
  port: number;
}

export function readAPIConfig(
  environment: Readonly<Record<string, string | undefined>>,
): Result<APIConfig, string[]> {
  const storeDirectory = environment['PEPYS_STORE_DIR'] ?? '';
  const port = Number(environment['PEPYS_API_PORT'] ?? '8081');

  const problems = [
    ...(storeDirectory === '' ? ['PEPYS_STORE_DIR is not set'] : []),
    ...(Number.isInteger(port) && port >= 0 && port <= 65_535
      ? []
      : ['PEPYS_API_PORT is not a port number']),
  ];

  if (problems.length > 0) {
    return { ok: false, failure: problems };
  }

  return { ok: true, value: { storeDirectory, port } };
}
