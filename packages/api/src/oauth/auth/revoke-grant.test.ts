import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { buildEnrolledPasskeySeeder } from '../test-utils/build-enrolled-passkey-seeder.ts';
import { buildHookedAuthOpener } from '../test-utils/build-hooked-auth-opener.ts';
import { buildSeeder } from '../test-utils/build-seeder.ts';
import { buildStubAuthenticator } from '../test-utils/build-stub-authenticator.ts';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { readJSONRecord } from '../test-utils/read-json-record.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { runMCPAuthorization } from '../test-utils/run-mcp-authorization.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readGrantViews } from './read-grant-views.ts';
import { revokeGrant } from './revoke-grant.ts';
import { systemClock } from './system-clock.ts';
import type { OAuthGrantID } from './types.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-revoke-grant-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  // The server's queries pass the hook, and the store below has a connection
  // of its own, as the grants command in another process has.
  const opener = buildHookedAuthOpener(openTestAuthDatabase);

  const server = await startHarbourMCPServer({
    dbPath,
    openAuthDatabase: opener.openDatabase,
  });

  const store = await openMCPAuth({ dbPath, openDatabase: openTestAuthDatabase, origin: null });

  registerTestCleanup(() => store.close());

  const authenticator = buildStubAuthenticator();
  const deps = { db: store.db, clock: systemClock };

  return {
    url: server.url,
    origin: server.origin,
    authenticator,
    store,
    armBeforeServerQuery: opener.armBeforeQuery,
    seed: { ...buildSeeder(deps), ...buildEnrolledPasskeySeeder({ ...deps, server }) },
  };
}

test("it forgets the consent its client held along with the grant's tokens", async () => {
  const ctx = await setupTest();

  await ctx.seed.enrolledPasskey({ authenticator: ctx.authenticator });

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
  });

  const clientID = created.clientID;

  const authorized = await runMCPAuthorization(ctx, {
    clientID,
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
      client_id: clientID,
      code_verifier: authorized.verifier,
    }),
  });

  const [grant] = await readGrantViews(ctx.store.db);

  invariant(grant !== undefined, 'the exchange left no grant');

  const revoked = await revokeGrant(ctx.store.db, grant.grantID);
  const consents = await ctx.store.db.selectFrom('oauthConsent').select('id').execute();
  const grants = await readGrantViews(ctx.store.db);

  expect(revoked).toBeTrue();
  expect(consents).toStrictEqual([]);
  expect(grants).toStrictEqual([]);
});

test('it reports an unknown grant id as not revoked', async () => {
  const ctx = await setupTest();
  const revoked = await revokeGrant(ctx.store.db, toTagged<OAuthGrantID>('unknown-grant'));

  expect(revoked).toBeFalse();
});

test("it never removes another grant's tokens or another client's consent", async () => {
  const ctx = await setupTest();

  await ctx.seed.enrolledPasskey({ authenticator: ctx.authenticator });

  const revoked = await ctx.store.auth.api.createFixedClient({
    body: { name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
  });

  const kept = await ctx.store.auth.api.createFixedClient({
    body: { name: 'Cursor', redirectURIs: ['https://cursor.com/oauth/callback'] },
  });

  for (const client of [
    { clientID: revoked.clientID, redirectURI: 'https://assistant.example.com/callback' },
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

  const revokedGrant = grants.find((grant) => grant.clientID === revoked.clientID);
  const keptGrant = grants.find((grant) => grant.clientID === kept.clientID);

  invariant(revokedGrant !== undefined && keptGrant !== undefined, 'the exchanges left no grants');

  await revokeGrant(ctx.store.db, revokedGrant.grantID);

  const accessTokens = await ctx.store.db
    .selectFrom('oauthAccessToken')
    .select('authorizationCodeId')
    .execute();

  const refreshTokens = await ctx.store.db
    .selectFrom('oauthRefreshToken')
    .select('authorizationCodeId')
    .execute();

  const consents = await ctx.store.db.selectFrom('oauthConsent').select('clientId').execute();

  expect(accessTokens).toStrictEqual([{ authorizationCodeId: keptGrant.grantID }]);
  expect(refreshTokens).toStrictEqual([{ authorizationCodeId: keptGrant.grantID }]);
  expect(consents).toStrictEqual([{ clientId: kept.clientID }]);
});

test.each([
  ['refresh', /^insert into "oauthRefreshToken"/u],
  ['access', /^insert into "oauthAccessToken"/u],
])(
  'it leaves no token of a grant revoked while a refresh writes its new %s token',
  async (_kind, query) => {
    const ctx = await setupTest();

    await ctx.seed.enrolledPasskey({ authenticator: ctx.authenticator });

    const created = await ctx.store.auth.api.createFixedClient({
      body: { name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
    });

    const clientID = created.clientID;

    const authorized = await runMCPAuthorization(ctx, {
      clientID,
      redirectURI: 'https://assistant.example.com/callback',
      scope: 'read offline_access',
      ticked: ['read'],
    });

    const exchanged = await fetch(`${ctx.url}/oauth2/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: authorized.code,
        redirect_uri: 'https://assistant.example.com/callback',
        client_id: clientID,
        code_verifier: authorized.verifier,
      }),
    });

    const tokens = await readJSONRecord(exchanged);
    const [grant] = await readGrantViews(ctx.store.db);

    invariant(grant !== undefined, 'the exchange left no grant');

    const revoked: boolean[] = [];

    ctx.armBeforeServerQuery(query, async () => {
      const result = await revokeGrant(ctx.store.db, grant.grantID);

      revoked.push(result);
    });

    const refreshed = await fetch(`${ctx.url}/oauth2/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: String(tokens['refresh_token']),
        client_id: clientID,
      }),
    });

    const accessTokens = await ctx.store.db
      .selectFrom('oauthAccessToken')
      .select('id')
      .where('authorizationCodeId', '=', grant.grantID)
      .execute();

    const refreshTokens = await ctx.store.db
      .selectFrom('oauthRefreshToken')
      .select('id')
      .where('authorizationCodeId', '=', grant.grantID)
      .execute();

    expect(revoked).toStrictEqual([true]);
    expect(refreshed.status).toBe(500);
    expect({ accessTokens, refreshTokens }).toStrictEqual({ accessTokens: [], refreshTokens: [] });
  },
);
