import { expect, onTestFinished, setSystemTime, test } from 'bun:test';
import { join } from 'node:path';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readClientViews } from './read-client-views.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-collect-clients-');

  const store = await openMCPAuth({
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    openDatabase: openTestAuthDatabase,
    origin: null,
  });

  registerTestCleanup(() => store.close());

  return { store };
}

test('it lists every client with its redirect URIs, oldest first', async () => {
  const ctx = await setupTest();

  onTestFinished(() => {
    setSystemTime();
  });

  // The client added last is the older one, so insertion order cannot
  // pass for creation order. better-auth stamps a client's creation time
  // from the system clock.
  setSystemTime(new Date('2026-01-02T00:00:00.000Z'));

  const claude = await ctx.store.auth.api.createFixedClient({
    body: {
      name: 'Claude',
      redirectURIs: [
        'https://assistant.example.com/callback',
        'https://claude.com/api/mcp/auth_callback',
      ],
    },
  });

  setSystemTime(new Date('2026-01-01T00:00:00.000Z'));

  const chatGPT = await ctx.store.auth.api.createFixedClient({
    body: {
      name: 'ChatGPT',
      redirectURIs: ['https://chat.example.com/connector_platform_oauth_redirect'],
    },
  });

  const clients = await readClientViews(ctx.store.db);

  expect(clients).toStrictEqual([
    {
      clientID: chatGPT.clientID,
      name: 'ChatGPT',
      redirectURIs: ['https://chat.example.com/connector_platform_oauth_redirect'],
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      clientID: claude.clientID,
      name: 'Claude',
      redirectURIs: [
        'https://assistant.example.com/callback',
        'https://claude.com/api/mcp/auth_callback',
      ],
      createdAt: '2026-01-02T00:00:00.000Z',
    },
  ]);
});
