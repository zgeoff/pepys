import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { openMCPAuthDatabase } from '../admin/open-mcp-auth-database.ts';
import { createEnrollmentToken } from '../auth/create-enrollment-token.ts';
import { openMCPAuth } from '../auth/open-mcp-auth.ts';
import { buildStubAuthenticator } from './build-stub-authenticator.ts';
import { registerTestCleanup } from './register-test-cleanup.ts';
import { runPasskeyEnrollment } from './run-passkey-enrollment.ts';
import { runPasskeySignIn } from './run-passkey-sign-in.ts';
import { setupTempDir } from './setup-temp-dir.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-run-passkey-sign-in-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  const server = await startHarbourMCPServer({
    dbPath,
  });

  const store = await openMCPAuth({ dbPath, openDatabase: openMCPAuthDatabase, origin: null });

  registerTestCleanup(() => store.close());

  const authenticator = buildStubAuthenticator();

  const enrollment = await createEnrollmentToken(store.db, Date.now());

  await runPasskeyEnrollment(server, enrollment.token, authenticator);

  return { url: server.url, origin: server.origin, authenticator, store };
}

test('it signs in for the request the login page belongs to and lands on its consent page', async () => {
  const ctx = await setupTest();

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'dots', redirectURIs: ['https://dots.example/cb'] },
  });

  const authorize = new URL(`${ctx.url}/oauth2/authorize`);

  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: created.clientID,
    redirect_uri: 'https://dots.example/cb',
    scope: 'read',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
  }).toString();

  const started = await fetch(authorize, { redirect: 'manual' });

  const login = new URL(started.headers.get('location') ?? '/', ctx.url);

  const signedIn = await runPasskeySignIn(ctx, login);

  expect(signedIn.status).toBe(302);
  expect(new URL(signedIn.headers.get('location') ?? '/').pathname).toBe('/consent');
});

test('it sends the ceremony values it is given in place of the honest ones', async () => {
  const ctx = await setupTest();

  const created = await ctx.store.auth.api.createFixedClient({
    body: { name: 'dots', redirectURIs: ['https://dots.example/cb'] },
  });

  const authorize = new URL(`${ctx.url}/oauth2/authorize`);

  authorize.search = new URLSearchParams({
    response_type: 'code',
    client_id: created.clientID,
    redirect_uri: 'https://dots.example/cb',
    scope: 'read',
    code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    code_challenge_method: 'S256',
  }).toString();

  const started = await fetch(authorize, { redirect: 'manual' });

  const login = new URL(started.headers.get('location') ?? '/', ctx.url);

  const signedIn = await runPasskeySignIn(ctx, login, { origin: 'https://elsewhere.example' });

  expect(signedIn.status).toBe(400);
});

test('it throws when the page holds no sign-in ceremony', async () => {
  const ctx = await setupTest();

  const signingIn = runPasskeySignIn(ctx, new URL(`${ctx.url}/login?client_id=unknown`));

  expect(signingIn).rejects.toThrowWithMessage(Error, 'the page holds no passkey ceremony');
});
