import { join } from 'node:path';
import { checkDeployment, defineDeployment } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import invariant from 'tiny-invariant';
import { createApp } from '../../app/create-app.ts';
import { buildQueryContext } from '../../queries/build-query-context.ts';
import { harbourPlugin } from '../../test-utils/harbour/harbour-plugin.ts';
import { openMCPAuthDatabase } from '../admin/open-mcp-auth-database.ts';
import { createEnrollmentToken } from '../auth/create-enrollment-token.ts';
import { openMCPAuth } from '../auth/open-mcp-auth.ts';
import { startMCPHTTPServer } from '../http/start-mcp-http-server.ts';
import { buildStubAuthenticator } from './build-stub-authenticator.ts';
import { registerTestCleanup } from './register-test-cleanup.ts';
import { runPasskeyEnrollment } from './run-passkey-enrollment.ts';
import { setupTempDir } from './setup-temp-dir.ts';

interface MCPHTTPSetupOptions {
  // Further Host header values the server accepts.
  readonly allowedHosts?: readonly string[];
}

// The API of the harbour deployment on a free loopback port, with the OAuth
// server's database in a temp folder and the owner's passkey enrolled on the
// authenticator it returns.
export async function setupMCPHTTP(options: MCPHTTPSetupOptions = {}) {
  const temporaryDirectory = setupTempDir('pepys-mcp-http-');

  // Registered after the directory, so it releases first: each part stops
  // before the one it depends on, and the directory goes last.
  const stack = new AsyncDisposableStack();

  const teardown = registerTestCleanup(() => stack.disposeAsync());

  stack.defer(temporaryDirectory.teardown);

  const deployment = defineDeployment({ name: 'harbour', plugins: [harbourPlugin] });
  const checked = checkDeployment(deployment);

  invariant(checked.ok, 'the harbour deployment is valid');

  const harbour = await createTestStore({ plugins: [harbourPlugin] });

  stack.defer(() => harbour[Symbol.asyncDispose]());

  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');
  const security: string[] = [];
  const logged: string[] = [];

  const server = await startMCPHTTPServer({
    host: '127.0.0.1',
    port: 0,
    publicURL: null,
    allowedHosts: options.allowedHosts ?? [],
    trustForwardedFrom: [],
    dbPath,
    openAuthDatabase: openMCPAuthDatabase,
    createServedApp: (oauth) =>
      createApp(buildQueryContext(harbour.reader, checked.value), {
        logError: (message) => {
          logged.push(message);
        },
        oauth,
      }),
    printSecurity: (line) => {
      security.push(line);
    },
  });

  stack.defer(() => server.stop());

  const store = await openMCPAuth({ dbPath, openDatabase: openMCPAuthDatabase, origin: null });

  stack.defer(() => store.close());

  const authenticator = buildStubAuthenticator();

  const enrollment = await createEnrollmentToken(store.db, Date.now());

  await runPasskeyEnrollment(server, enrollment.token, authenticator);

  // The lines the enrollment printed are not part of any scenario.
  security.length = 0;

  return {
    home: temporaryDirectory.path,
    url: server.url,
    origin: server.origin,
    dbPath,
    authenticator,
    security,
    logged,
    harbour,
    store,
    async createClient(name: string, redirectURIs: readonly string[]): Promise<string> {
      const created = await store.auth.api.createFixedClient({
        body: { name, redirectURIs: [...redirectURIs] },
      });

      return created.clientID;
    },
    teardown,
  };
}
