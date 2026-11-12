import { expect, test } from 'bun:test';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { buildSeeder } from '../test-utils/build-seeder.ts';
import { buildStubAuthenticator } from '../test-utils/build-stub-authenticator.ts';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { runMCPAuthorization } from '../test-utils/run-mcp-authorization.ts';
import { runPasskeyEnrollment } from '../test-utils/run-passkey-enrollment.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { createEnrollmentToken } from './create-enrollment-token.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readClientViews } from './read-client-views.ts';
import { readGrantViews } from './read-grant-views.ts';
import { removeClient } from './remove-client.ts';
import { systemClock } from './system-clock.ts';
import { writeGrantUse } from './write-grant-use.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-remove-client-');
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

  return {
    url: server.url,
    origin: server.origin,
    authenticator,
    store,
    seed: buildSeeder({ db: store.db, clock: systemClock }),
  };
}

test('it removes a client and reports it removed', async () => {
  const ctx = await setupTest();

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
  });

  const removed = await removeClient(ctx.store.db, created.clientID);

  expect(removed).toBeTrue();
  expect(readClientViews(ctx.store.db)).resolves.toStrictEqual([]);
});

test('it reports an unknown client id as not removed', async () => {
  const ctx = await setupTest();
  const removed = await removeClient(ctx.store.db, 'unknown-client');

  expect(removed).toBeFalse();
});

test("it never removes another client's tokens, consent or grant use", async () => {
  const ctx = await setupTest();

  const removed = await ctx.store.auth.api.createFixedClient({
    body: { name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
  });

  const kept = await ctx.store.auth.api.createFixedClient({
    body: { name: 'Cursor', redirectURIs: ['https://cursor.com/oauth/callback'] },
  });

  for (const client of [
    { clientID: removed.clientID, redirectURI: 'https://assistant.example.com/callback' },
    { clientID: kept.clientID, redirectURI: 'https://cursor.com/oauth/callback' },
  ]) {
    const authorized = await runMCPAuthorization(ctx, {
      ...client,
      scope: 'read',
      ticked: ['read'],
    });

    await fetch(`${ctx.url}/oauth2/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorized.code,
        redirect_uri: client.redirectURI,
        client_id: client.clientID,
        code_verifier: authorized.verifier,
      }),
    });
  }

  const grants = await readGrantViews(ctx.store.db);

  for (const grant of grants) {
    await writeGrantUse(ctx.store.db, grant.grantID, Date.UTC(2026, 9, 8, 0, 0, 0));
  }

  const keptGrant = grants.find((grant) => grant.clientID === kept.clientID);

  invariant(keptGrant !== undefined, 'the exchange left the kept client no grant');

  await removeClient(ctx.store.db, removed.clientID);

  const accessTokens = await ctx.store.db
    .selectFrom('oauthAccessToken')
    .select('clientId')
    .execute();

  const refreshTokens = await ctx.store.db
    .selectFrom('oauthRefreshToken')
    .select('clientId')
    .execute();

  const consents = await ctx.store.db.selectFrom('oauthConsent').select('clientId').execute();
  const grantUses = await ctx.store.db.selectFrom('pepys_grant_use').select('grant_id').execute();

  expect(accessTokens).toStrictEqual([{ clientId: kept.clientID }]);
  expect(refreshTokens).toStrictEqual([{ clientId: kept.clientID }]);
  expect(consents).toStrictEqual([{ clientId: kept.clientID }]);
  expect(grantUses).toStrictEqual([{ grant_id: keptGrant.grantID }]);
});
