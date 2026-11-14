import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { DeploymentClient } from '@pepys/api';
import type { HttpClient } from '@wringer/http';
import type { e2eDeployment } from '../../packages/cli/e2e/fixtures/e2e-deployment.ts';

// The e2e deployment's typed API client, which sends each call through the http driver, so the
// driver keeps every request and answer as evidence. The driver joins each path to the API's
// endpoint, so the link's own origin goes unused.
export function createAPIClient(http: HttpClient): DeploymentClient<typeof e2eDeployment> {
  const handleRequest = (url: string | URL, init: RequestInit): Promise<Response> =>
    sendThroughDriver(http, new URL(url), init);

  const link = new RPCLink({
    url: '/rpc',
    origin: 'http://api.invalid',
    method: 'POST',
    fetch: handleRequest,
  });

  return createORPCClient(link);
}

async function sendThroughDriver(http: HttpClient, url: URL, init: RequestInit): Promise<Response> {
  const body = typeof init.body === 'string' ? init.body : '';
  const json: unknown = body === '' ? undefined : JSON.parse(body);

  const response = await http.request({
    method: 'POST',
    path: `${url.pathname}${url.search}`,
    headers: Object.fromEntries(new Headers(init.headers).entries()),
    json,
  });

  return new Response(response.body, { status: response.status, headers: response.headers });
}
