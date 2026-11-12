import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readOwnerSessionViews } from './read-owner-session-views.ts';

// A temp directory that holds an authorization database, opened the way
// the server opens it.
async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-read-owner-sessions-');

  const store = await openMCPAuth({
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    openDatabase: openTestAuthDatabase,
    origin: null,
  });

  registerTestCleanup(() => store.close());

  return { db: store.db, auth: store.auth };
}

test('it lists the browser sign-in an owner login starts, with when it expires', async () => {
  const ctx = await setupTest();

  await ctx.auth.api.signInOwner({ body: {} });

  const sessions = await readOwnerSessionViews(ctx.db);

  expect(sessions).toStrictEqual([{ id: expect.any(String), expiresAt: expect.toBeDateString() }]);
});

test('it lists nothing when no one is signed in', async () => {
  const ctx = await setupTest();
  const sessions = await readOwnerSessionViews(ctx.db);

  expect(sessions).toStrictEqual([]);
});
