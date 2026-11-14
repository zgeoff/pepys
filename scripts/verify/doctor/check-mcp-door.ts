import { WringerError } from '@wringer/core';
import type { Endpoints } from '@wringer/core';
import { z } from 'zod';

// The doctor's check that the API's `/mcp`, at the target's `mcp` endpoint, answers a request with
// no token with 401 and a challenge that points at its resource metadata, as an MCP client needs
// before it signs in.
export async function checkMCPDoor(endpoints: Endpoints): Promise<{ url: string }> {
  const origin = z.url().parse(endpoints['mcp']);

  const url = new URL('/mcp', origin);

  const hint = `Check that the API at ${origin} runs with PEPYS_API_PUBLIC_URL set, then run \`bun verify doctor\` again.`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  }).catch((error: unknown) => {
    throw new WringerError('check-failed', {
      message: `/mcp at ${url.href} does not answer: ${String(error)}`,
      hint,
    });
  });

  const challenge = response.headers.get('www-authenticate') ?? '';

  if (response.status !== 401 || !challenge.includes('resource_metadata=')) {
    throw new WringerError('check-failed', {
      message: `/mcp at ${url.href} answered ${response.status} to a request with no token, where an MCP server answers 401 with a resource_metadata challenge`,
      hint,
    });
  }

  return { url: url.href };
}
