import type { Result } from './types.ts';

const digitsPattern = /^[0-9]+$/u;

export function parsePort(text: string): Result<number, { reason: 'not-a-port' }> {
  const port = digitsPattern.test(text) ? Number(text) : Number.NaN;

  if (port >= 1 && port <= 65_535) {
    return { ok: true, value: port };
  }

  return { ok: false, failure: { reason: 'not-a-port' } };
}
