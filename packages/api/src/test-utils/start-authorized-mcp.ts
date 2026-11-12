import { join } from 'node:path';
import { createApp } from '../app/create-app.ts';
import { openMCPAuthDatabase } from '../oauth/admin/open-mcp-auth-database.ts';
import { createEnrollmentToken } from '../oauth/auth/create-enrollment-token.ts';
import { openMCPAuth } from '../oauth/auth/open-mcp-auth.ts';
import { startMCPHTTPServer } from '../oauth/http/start-mcp-http-server.ts';
import { buildStubAuthenticator } from '../oauth/test-utils/build-stub-authenticator.ts';
import { registerTestCleanup } from '../oauth/test-utils/register-test-cleanup.ts';
import { runMCPTokenGrant } from '../oauth/test-utils/run-mcp-token-grant.ts';
import { runPasskeyEnrollment } from '../oauth/test-utils/run-passkey-enrollment.ts';
import { setupTempDir } from '../oauth/test-utils/setup-temp-dir.ts';
import type { QueryContext } from '../queries/types.ts';

type LogError = (message: string, error: unknown) => void;

const REDIRECT_URI = 'https://assistant.example.com/callback';

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
    openAuthDatabase: openMCPAuthDatabase,
    createServedApp: (oauth) => createApp(context, { logError, oauth }),
    printSecurity: () => {},
  });

  registerTestCleanup(() => server.stop());

  const store = await openMCPAuth({ dbPath, openDatabase: openMCPAuthDatabase, origin: null });

  registerTestCleanup(() => store.close());

  const authenticator = buildStubAuthenticator();

  const enrollment = await createEnrollmentToken(store.db, Date.now());

  await runPasskeyEnrollment(server, enrollment.token, authenticator);

  const created = await store.auth.api.createFixedClient({
    body: { name: 'harbour assistant', redirectURIs: [REDIRECT_URI] },
  });

  const grant = await runMCPTokenGrant(
    { url: server.url, origin: server.origin, authenticator },
    { clientID: created.clientID, redirectURI: REDIRECT_URI, scope: 'read', ticked: ['read'] },
  );

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
