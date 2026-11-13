import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { openMCPAuthDatabase } from '../admin/open-mcp-auth-database.ts';
import { openMCPAuth } from '../auth/open-mcp-auth.ts';
import { systemClock } from '../auth/system-clock.ts';
import { buildEnrolledPasskeySeeder } from './build-enrolled-passkey-seeder.ts';
import { buildStubAuthenticator } from './build-stub-authenticator.ts';
import { registerTestCleanup } from './register-test-cleanup.ts';
import { runMCPTokenGrant } from './run-mcp-token-grant.ts';
import { setupTempDir } from './setup-temp-dir.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-run-mcp-token-grant-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  const server = await startHarbourMCPServer({
    dbPath,
  });

  const store = await openMCPAuth({ dbPath, openDatabase: openMCPAuthDatabase, origin: null });

  registerTestCleanup(() => store.close());

  const authenticator = buildStubAuthenticator();

  return {
    url: server.url,
    origin: server.origin,
    authenticator,
    store,
    seed: buildEnrolledPasskeySeeder({ db: store.db, clock: systemClock, server }),
  };
}

test('it returns an access token that holds the ticked scopes', async () => {
  const ctx = await setupTest();

  await ctx.seed.enrolledPasskey({ authenticator: ctx.authenticator });

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'dots', redirectURIs: ['https://dots.example/cb'] },
  });

  const grant = await runMCPTokenGrant(ctx, {
    clientID: created.clientID,
    redirectURI: 'https://dots.example/cb',
    scope: 'read',
    ticked: ['read'],
  });

  const answered = await fetch(`${ctx.url}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${grant.accessToken}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });

  expect(grant.scope).toBe('read offline_access');
  expect(answered.status).toBe(200);
});
