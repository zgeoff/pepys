import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { buildEnrolledPasskeySeeder } from '../test-utils/build-enrolled-passkey-seeder.ts';
import { buildStubAuthenticator } from '../test-utils/build-stub-authenticator.ts';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { runMCPAuthorization } from '../test-utils/run-mcp-authorization.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readConsentViews } from './read-consent-views.ts';
import { systemClock } from './system-clock.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-read-consent-views-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  const server = await startHarbourMCPServer({
    dbPath,
    openAuthDatabase: openTestAuthDatabase,
  });

  const store = await openMCPAuth({ dbPath, openDatabase: openTestAuthDatabase, origin: null });

  registerTestCleanup(() => store.close());

  return {
    url: server.url,
    origin: server.origin,
    authenticator: buildStubAuthenticator(),
    store,
    seed: buildEnrolledPasskeySeeder({ db: store.db, clock: systemClock, server }),
  };
}

test('it reads the consent of a client the owner approved', async () => {
  const ctx = await setupTest();

  await ctx.seed.enrolledPasskey({ authenticator: ctx.authenticator });

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
  });

  await runMCPAuthorization(ctx, {
    clientID: created.clientID,
    redirectURI: 'https://assistant.example.com/callback',
    scope: 'read',
    ticked: ['read'],
  });

  const consents = await readConsentViews(ctx.store.db);

  expect(consents).toStrictEqual([{ clientID: created.clientID }]);
});

test('it reads no consent from a database with none', async () => {
  const ctx = await setupTest();

  expect(readConsentViews(ctx.store.db)).resolves.toStrictEqual([]);
});
