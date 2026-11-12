import { expect, test } from 'bun:test';
import { readClientViews } from '../oauth/auth/read-client-views.ts';
import { readPasskeyViews } from '../oauth/auth/read-passkey-views.ts';
import { setupMCPHTTP } from './setup-mcp-http.ts';

test("it enrolls the owner's passkey on the authenticator it returns, and keeps no line of it", async () => {
  const server = await setupMCPHTTP();
  const passkeys = await readPasskeyViews(server.store.db);

  expect({ passkeys, security: server.security }).toStrictEqual({
    passkeys: [
      { id: server.authenticator.credentialID, createdAt: expect.toBeString(), lastUsedAt: null },
    ],
    security: [],
  });
});

test('it registers a client with its redirect URIs and returns its ID', async () => {
  const server = await setupMCPHTTP();
  const clientID = await server.createClient('tide almanac', ['https://almanac.example/cb']);
  const clients = await readClientViews(server.store.db);

  expect(clients).toStrictEqual([
    {
      clientID,
      name: 'tide almanac',
      redirectURIs: ['https://almanac.example/cb'],
      createdAt: expect.toBeString(),
    },
  ]);
});

test('it serves the OAuth routes under a further host it is given', async () => {
  const server = await setupMCPHTTP({ allowedHosts: ['quay.tailnet.example'] });

  const answered = await fetch(`${server.url}/.well-known/oauth-protected-resource/mcp`, {
    headers: { host: 'quay.tailnet.example' },
  });

  expect(answered.status).toBe(200);
});

test('it refuses the OAuth routes under a host it is not given', async () => {
  const server = await setupMCPHTTP();

  const answered = await fetch(`${server.url}/.well-known/oauth-protected-resource/mcp`, {
    headers: { host: 'quay.tailnet.example' },
  });

  expect(answered.status).toBe(403);
});

test('it stops the server and removes its folder on teardown', async () => {
  const server = await setupMCPHTTP();

  await server.teardown();

  const reaching = fetch(`${server.url}/.well-known/oauth-protected-resource/mcp`);
  const folder = Bun.file(server.dbPath);

  expect(reaching).rejects.toThrow();
  expect(folder.exists()).resolves.toBeFalse();
});
