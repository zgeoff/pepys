import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { toTagged } from '@zgeoff/std';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { openMCPAuth } from '../auth/open-mcp-auth.ts';
import { systemClock } from '../auth/system-clock.ts';
import type { OAuthGrantID } from '../auth/types.ts';
import { buildEnrolledPasskeySeeder } from './build-enrolled-passkey-seeder.ts';
import { buildStubAuthenticator } from './build-stub-authenticator.ts';
import { openTestAuthDatabase } from './open-test-auth-database.ts';
import { registerTestCleanup } from './register-test-cleanup.ts';
import { runMCPAuthorization } from './run-mcp-authorization.ts';
import { seedGrantID } from './seed-grant-id.ts';
import { setupTempDir } from './setup-temp-dir.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-seed-grant-id-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  const server = await startHarbourMCPServer({
    dbPath,
    openAuthDatabase: openTestAuthDatabase,
  });

  const store = await openMCPAuth({ dbPath, openDatabase: openTestAuthDatabase, origin: null });

  registerTestCleanup(() => store.close());

  const authenticator = buildStubAuthenticator();

  return {
    url: server.url,
    origin: server.origin,
    authenticator,
    store,
    db: store.db,
    seed: buildEnrolledPasskeySeeder({ db: store.db, clock: systemClock, server }),
  };
}

test("it gives the client's access and refresh tokens the grant id it is passed", async () => {
  const ctx = await setupTest();

  await ctx.seed.enrolledPasskey({ authenticator: ctx.authenticator });

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
  });

  const authorized = await runMCPAuthorization(ctx, {
    clientID: created.clientID,
    redirectURI: 'https://assistant.example.com/callback',
    scope: 'read',
    ticked: ['read'],
  });

  await fetch(`${ctx.url}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorized.code,
      redirect_uri: 'https://assistant.example.com/callback',
      client_id: created.clientID,
      code_verifier: authorized.verifier,
    }),
  });

  await seedGrantID(ctx, {
    clientID: created.clientID,
    grantID: toTagged<OAuthGrantID>('-dash_grant'),
  });

  expect(
    ctx.db.selectFrom('oauthAccessToken').select('authorizationCodeId').execute(),
  ).resolves.toStrictEqual([{ authorizationCodeId: toTagged<OAuthGrantID>('-dash_grant') }]);

  expect(
    ctx.db.selectFrom('oauthRefreshToken').select('authorizationCodeId').execute(),
  ).resolves.toStrictEqual([{ authorizationCodeId: toTagged<OAuthGrantID>('-dash_grant') }]);
});
