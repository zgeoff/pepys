import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { registerTestCleanup } from './register-test-cleanup.ts';
import { seedLegacyClient } from './seed-legacy-client.ts';
import { setupTempDir } from './setup-temp-dir.ts';

// A database file path in the test's temp folder, and a reader that opens the
// file the seed wrote.
function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-legacy-client-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  return {
    dbPath,
    openFile: () => {
      const sqlite = new Database(dbPath, { readonly: true });

      registerTestCleanup(() => {
        sqlite.close();
      });

      return sqlite;
    },
  };
}

test('it stores the client name as given, with no cleaning', async () => {
  const ctx = setupTest();

  const clientID = await seedLegacyClient(ctx.dbPath, '  Spaced\tOrchard  ');

  const row = ctx
    .openFile()
    .query('select "clientId", name, "redirectUris" from "oauthClient"')
    .all();

  expect(row).toMatchObject([
    {
      clientId: clientID,
      name: '  Spaced\tOrchard  ',
      redirectUris: '["https://assistant.example.com/callback"]',
    },
  ]);
});
