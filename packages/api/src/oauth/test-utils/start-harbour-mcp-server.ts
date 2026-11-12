import { checkDeployment, defineDeployment } from '@pepys/kit';
import { createTestStore } from '@pepys/testing';
import invariant from 'tiny-invariant';
import { createApp } from '../../app/create-app.ts';
import { buildQueryContext } from '../../queries/build-query-context.ts';
import { harbourPlugin } from '../../test-utils/harbour/harbour-plugin.ts';
import { openMCPAuthDatabase } from '../admin/open-mcp-auth-database.ts';
import { startMCPHTTPServer } from '../http/start-mcp-http-server.ts';
import { registerTestCleanup } from './register-test-cleanup.ts';

type ServerOptions = Parameters<typeof startMCPHTTPServer>[0];

type HarbourServerOptions = Pick<ServerOptions, 'dbPath'> &
  Partial<Omit<ServerOptions, 'dbPath' | 'createServedApp'>>;

// The API of the harbour deployment on a free loopback port with its OAuth
// routes, each option the server's own default unless the test sets it.
// The server and the harbour store stop when the test finishes.
export async function startHarbourMCPServer(options: HarbourServerOptions) {
  const checked = checkDeployment(defineDeployment({ name: 'harbour', plugins: [harbourPlugin] }));

  invariant(checked.ok, 'the harbour deployment is valid');

  const harbour = await createTestStore({ plugins: [harbourPlugin] });

  registerTestCleanup(() => harbour[Symbol.asyncDispose]());

  const server = await startMCPHTTPServer({
    host: '127.0.0.1',
    port: 0,
    publicURL: null,
    allowedHosts: [],
    trustForwardedFrom: [],
    openAuthDatabase: openMCPAuthDatabase,
    printSecurity: () => {},
    ...options,
    createServedApp: (oauth) =>
      createApp(buildQueryContext(harbour.reader, checked.value), {
        logError: () => {},
        oauth,
      }),
  });

  registerTestCleanup(() => server.stop());

  return server;
}
