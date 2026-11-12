import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { createEnrollmentToken } from '../auth/create-enrollment-token.ts';
import { openMCPAuth } from '../auth/open-mcp-auth.ts';
import { buildStubAuthenticator } from './build-stub-authenticator.ts';
import { openTestAuthDatabase } from './open-test-auth-database.ts';
import { registerTestCleanup } from './register-test-cleanup.ts';
import { runMCPTokenGrant } from './run-mcp-token-grant.ts';
import { runPasskeyEnrollment } from './run-passkey-enrollment.ts';
import { seedDPoPBinding } from './seed-dpop-binding.ts';
import { setupTempDir } from './setup-temp-dir.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-seed-dpop-binding-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  const server = await startHarbourMCPServer({
    dbPath,
    openAuthDatabase: openTestAuthDatabase,
  });

  const store = await openMCPAuth({ dbPath, openDatabase: openTestAuthDatabase, origin: null });

  registerTestCleanup(() => store.close());

  const authenticator = buildStubAuthenticator();

  const enrollment = await createEnrollmentToken(store.db, Date.now());

  await runPasskeyEnrollment(server, enrollment.token, authenticator);

  return { url: server.url, origin: server.origin, authenticator, store, db: store.db };
}

test("it binds the client's access token to the DPoP key it is passed", async () => {
  const ctx = await setupTest();

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
  });

  await runMCPTokenGrant(ctx, {
    clientID: created.clientID,
    redirectURI: 'https://assistant.example.com/callback',
    scope: 'read',
    ticked: ['read'],
  });

  await seedDPoPBinding(ctx, { clientID: created.clientID, jkt: 'thumbprint-of-a-key' });

  expect(
    ctx.db.selectFrom('oauthAccessToken').select('confirmation').execute(),
  ).resolves.toStrictEqual([{ confirmation: '{"jkt":"thumbprint-of-a-key"}' }]);
});
