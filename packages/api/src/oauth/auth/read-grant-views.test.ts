import { expect, onTestFinished, setSystemTime, test } from 'bun:test';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { buildStubAuthenticator } from '../test-utils/build-stub-authenticator.ts';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { readJSONRecord } from '../test-utils/read-json-record.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { runMCPAuthorization } from '../test-utils/run-mcp-authorization.ts';
import { runPasskeyEnrollment } from '../test-utils/run-passkey-enrollment.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { startHarbourMCPServer } from '../test-utils/start-harbour-mcp-server.ts';
import { createEnrollmentToken } from './create-enrollment-token.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readGrantViews } from './read-grant-views.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-collect-grants-');
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

  return { url: server.url, origin: server.origin, authenticator, store };
}

test('it lists a grant with its client and scopes and no last use before the grant is used', async () => {
  const ctx = await setupTest();

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

  const grants = await readGrantViews(ctx.store.db);

  expect(grants).toStrictEqual([
    {
      grantID: expect.toBeString(),
      clientID,
      clientName: 'Claude',
      scopes: ['read'],
      createdAt: expect.toBeString(),
      lastUsedAt: null,
    },
  ]);
});

test('it lists when a grant was last used', async () => {
  const ctx = await setupTest();

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

  const startedAt = Date.now();

  await fetch(`${ctx.url}/mcp`, {
    method: 'POST',
    headers: { authorization: `Bearer ${String(tokens['access_token'])}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });

  const grants = await readGrantViews(ctx.store.db);

  const lastUsedAt = grants[0]?.lastUsedAt;

  invariant(typeof lastUsedAt === 'string', 'the grant holds no last use');

  expect(grants).toStrictEqual([
    {
      grantID: expect.toBeString(),
      clientID,
      clientName: 'Claude',
      scopes: ['read'],
      createdAt: expect.toBeString(),
      lastUsedAt,
    },
  ]);

  expect(Date.parse(lastUsedAt)).toBeWithin(startedAt - 1000, Date.now() + 1);
});

test('it leaves out a grant whose refresh token was revoked', async () => {
  const ctx = await setupTest();

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

  await fetch(`${ctx.url}/oauth2/revoke`, {
    method: 'POST',
    body: new URLSearchParams({
      token: String(tokens['refresh_token']),
      token_type_hint: 'refresh_token',
      client_id: clientID,
    }),
  });

  const grants = await readGrantViews(ctx.store.db);

  expect(grants).toStrictEqual([]);
});

test('it lists the grants oldest first', async () => {
  const ctx = await setupTest();

  const claude = await ctx.store.auth.api.createFixedClient({
    body: { name: 'Claude', redirectURIs: ['https://assistant.example.com/callback'] },
  });

  const chatGPT = await ctx.store.auth.api.createFixedClient({
    body: {
      name: 'ChatGPT',
      redirectURIs: ['https://chat.example.com/connector_platform_oauth_redirect'],
    },
  });

  onTestFinished(() => {
    setSystemTime();
  });

  // The grant made last is the older one, so insertion order cannot pass
  // for creation order. better-auth stamps a grant's creation time from the
  // system clock.
  setSystemTime(new Date('2026-01-02T00:00:00.000Z'));

  const claudeAuthorized = await runMCPAuthorization(ctx, {
    clientID: claude.clientID,
    redirectURI: 'https://assistant.example.com/callback',
    scope: 'read',
    ticked: ['read'],
  });

  await fetch(`${ctx.url}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: claudeAuthorized.code,
      redirect_uri: 'https://assistant.example.com/callback',
      client_id: claude.clientID,
      code_verifier: claudeAuthorized.verifier,
    }),
  });

  setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

  const chatGPTAuthorized = await runMCPAuthorization(ctx, {
    clientID: chatGPT.clientID,
    redirectURI: 'https://chat.example.com/connector_platform_oauth_redirect',
    scope: 'read',
    ticked: ['read'],
  });

  await fetch(`${ctx.url}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: chatGPTAuthorized.code,
      redirect_uri: 'https://chat.example.com/connector_platform_oauth_redirect',
      client_id: chatGPT.clientID,
      code_verifier: chatGPTAuthorized.verifier,
    }),
  });

  const grants = await readGrantViews(ctx.store.db);

  expect(grants).toStrictEqual([
    {
      grantID: expect.toBeString(),
      clientID: chatGPT.clientID,
      clientName: 'ChatGPT',
      scopes: ['read'],
      createdAt: '2026-01-01T00:00:00.000Z',
      lastUsedAt: null,
    },
    {
      grantID: expect.toBeString(),
      clientID: claude.clientID,
      clientName: 'Claude',
      scopes: ['read'],
      createdAt: '2026-01-02T00:00:00.000Z',
      lastUsedAt: null,
    },
  ]);
});
