import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { openMCPAuthDatabase } from '../admin/open-mcp-auth-database.ts';
import { createEnrollmentToken } from '../auth/create-enrollment-token.ts';
import { openMCPAuth } from '../auth/open-mcp-auth.ts';
import { resetPasskeys } from '../auth/reset-passkeys.ts';
import { buildStubAuthenticator } from './build-stub-authenticator.ts';
import { registerTestCleanup } from './register-test-cleanup.ts';
import { runMCPAuthorization } from './run-mcp-authorization.ts';
import { runPasskeyEnrollment } from './run-passkey-enrollment.ts';
import { setupTempDir } from './setup-temp-dir.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-run-mcp-authorization-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  const server = await startHarbourMCPServer({
    dbPath,
  });

  // The authorization database opened the way the `clients` command opens it, to
  // register clients through.
  const store = await openMCPAuth({ dbPath, openDatabase: openMCPAuthDatabase, origin: null });

  registerTestCleanup(() => store.close());

  const authenticator = buildStubAuthenticator();

  const enrollment = await createEnrollmentToken(store.db, Date.now());

  await runPasskeyEnrollment(server, enrollment.token, authenticator);

  return { url: server.url, origin: server.origin, authenticator, store };
}

test('it returns at the redirect URI with an authorization code its verifier exchanges for tokens', async () => {
  const ctx = await setupTest();

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'dots', redirectURIs: ['https://dots.example/cb'] },
  });

  const authorized = await runMCPAuthorization(ctx, {
    clientID: created.clientID,
    redirectURI: 'https://dots.example/cb',
    scope: 'read',
    ticked: ['read'],
  });

  const exchanged = await fetch(`${ctx.url}/oauth2/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorized.code,
      redirect_uri: 'https://dots.example/cb',
      client_id: created.clientID,
      code_verifier: authorized.verifier,
    }),
  });

  expect(`${authorized.consent.origin}${authorized.consent.pathname}`).toBe(`${ctx.url}/consent`);
  expect(authorized.callback.href).toStartWith('https://dots.example/cb?code=');
  expect(authorized.callback.searchParams.get('code')).toBe(authorized.code);
  expect(authorized.verifier).toStartWith('test-verifier-');
  expect(exchanged.status).toBe(200);
});

test('it throws when the authorization stops short of the login page', async () => {
  const ctx = await setupTest();

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'dots', redirectURIs: ['https://dots.example/cb'] },
  });

  const authorizing = runMCPAuthorization(ctx, {
    clientID: created.clientID,
    redirectURI: 'https://dots.example/cb',
    scope: 'read write',
    ticked: ['read'],
  });

  expect(authorizing).rejects.toThrowWithMessage(
    Error,
    /^authorization did not reach the login page: https:\/\/dots\.example\/cb\?error=invalid_scope&/u,
  );
});

test('it throws when the login page holds no passkey ceremony', async () => {
  const ctx = await setupTest();

  await resetPasskeys(ctx.store.db);

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'dots', redirectURIs: ['https://dots.example/cb'] },
  });

  const authorizing = runMCPAuthorization(ctx, {
    clientID: created.clientID,
    redirectURI: 'https://dots.example/cb',
    scope: 'read',
    ticked: ['read'],
  });

  expect(authorizing).rejects.toThrowWithMessage(Error, 'the page holds no passkey ceremony');
});

test('it throws when the passkey sign-in does not reach the consent page', async () => {
  const ctx = await setupTest();

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'dots', redirectURIs: ['https://dots.example/cb'] },
  });

  const stranger = buildStubAuthenticator();

  await stranger.create(
    { challenge: 'c3RyYW5nZXI', rp: { id: '127.0.0.1' }, user: { id: 'c3RyYW5nZXI' } },
    { origin: ctx.origin },
  );

  const authorizing = runMCPAuthorization(
    { url: ctx.url, origin: ctx.origin, authenticator: stranger },
    {
      clientID: created.clientID,
      redirectURI: 'https://dots.example/cb',
      scope: 'read',
      ticked: ['read'],
    },
  );

  expect(authorizing).rejects.toThrowWithMessage(
    Error,
    `the passkey sign-in did not reach the consent page: ${ctx.url}/`,
  );
});
