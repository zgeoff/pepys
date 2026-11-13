import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { buildEnrolledPasskeySeeder } from '../test-utils/build-enrolled-passkey-seeder.ts';
import { buildStubAuthenticator } from '../test-utils/build-stub-authenticator.ts';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { readJSONRecord } from '../test-utils/read-json-record.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { runMCPAuthorization } from '../test-utils/run-mcp-authorization.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readTokenViews } from './read-token-views.ts';
import { systemClock } from './system-clock.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-read-token-views-');
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

test('it reads the access and refresh token of an exchanged code with its client and grant', async () => {
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

  const tokens = await readTokenViews(ctx.store.db);

  expect(tokens).toStrictEqual({
    accessTokens: [{ clientID: created.clientID, grantID: expect.toBeString() }],
    refreshTokens: [{ clientID: created.clientID, grantID: expect.toBeString() }],
  });
});

test('it reads a refresh token that a refresh revoked beside the one it issued', async () => {
  const ctx = await setupTest();

  await ctx.seed.enrolledPasskey({ authenticator: ctx.authenticator });

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
  });

  const authorized = await runMCPAuthorization(ctx, {
    clientID: created.clientID,
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
      client_id: created.clientID,
      code_verifier: authorized.verifier,
    }),
  });

  const issued = await readJSONRecord(exchanged);

  await fetch(`${ctx.url}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: String(issued['refresh_token']),
      client_id: created.clientID,
    }),
  });

  const tokens = await readTokenViews(ctx.store.db);

  expect(tokens.refreshTokens).toStrictEqual([
    { clientID: created.clientID, grantID: expect.toBeString() },
    { clientID: created.clientID, grantID: expect.toBeString() },
  ]);
});

test('it reads no token from a database with none', async () => {
  const ctx = await setupTest();

  expect(readTokenViews(ctx.store.db)).resolves.toStrictEqual({
    accessTokens: [],
    refreshTokens: [],
  });
});
