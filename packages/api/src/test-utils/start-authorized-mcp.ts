import { join } from 'node:path';
import { createApp } from '../app/create-app.ts';
import { startMCPHTTPServer } from '../oauth/http/start-mcp-http-server.ts';
import { registerTestCleanup } from '../oauth/test-utils/register-test-cleanup.ts';
import { setupTempDir } from '../oauth/test-utils/setup-temp-dir.ts';
import type { QueryContext } from '../queries/types.ts';
import { authorizeMCPClient } from './authorize-mcp-client.ts';

type LogError = (message: string, error: unknown) => void;

// The API of a query context on a free loopback port, and a read token one
// client got through passkey sign-in and consent. Each request it sends goes to
// this server with that token, at the request's path, whatever origin it names.
export async function startAuthorizedMCP(context: QueryContext, logError: LogError) {
  const temporaryDirectory = setupTempDir('pepys-authorized-mcp-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  const server = await startMCPHTTPServer({
    host: '127.0.0.1',
    port: 0,
    publicURL: null,
    allowedHosts: [],
    trustForwardedFrom: [],
    dbPath,
    createServedApp: (oauth) => createApp(context, { logError, oauth }),
    printSecurity: () => {},
  });

  registerTestCleanup(() => server.stop());

  const grant = await authorizeMCPClient({ origin: server.origin, dbPath }, ['read']);

  return {
    sendRequest: async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      const headers = new Headers(request.headers);

      headers.set('authorization', `Bearer ${grant.accessToken}`);

      return fetch(`${server.url}${url.pathname}${url.search}`, {
        method: request.method,
        headers,
        body: await request.text(),
      });
    },
  };
}
