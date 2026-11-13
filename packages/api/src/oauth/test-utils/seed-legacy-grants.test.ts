import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { join } from 'node:path';
import { registerTestCleanup } from './register-test-cleanup.ts';
import { seedLegacyGrants } from './seed-legacy-grants.ts';
import { setupTempDir } from './setup-temp-dir.ts';

// A file path in the test's temp folder, and a reader that opens the file the
// seed wrote.
function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-legacy-grants-');
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

test('it points every token of each grant at one owner row, one refresh token live per grant', () => {
  const ctx = setupTest();

  const legacy = seedLegacyGrants(
    ctx.dbPath,
    [
      { clientName: 'Claude', refreshes: 2 },
      { clientName: 'Tide almanac', refreshes: 0 },
    ],
    Date.UTC(2026, 10, 1),
  );

  const sqlite = ctx.openFile();

  expect({
    owners: sqlite.query('select email from "user"').all(),
    refresh: sqlite
      .query(
        'select "authorizationCodeId" as grant, count(*) as issued, sum(revoked is null) as live, count(distinct "userId") as users from "oauthRefreshToken" group by "authorizationCodeId" order by issued desc',
      )
      .all(),
    access: sqlite.query('select count(*) as count from "oauthAccessToken"').get(),
    clients: sqlite.query('select name from "oauthClient" order by name').all(),
  }).toStrictEqual({
    owners: [{ email: 'owner@pepys.invalid' }],
    refresh: [
      { grant: legacy.grants[0]?.grantID, issued: 3, live: 1, users: 1 },
      { grant: legacy.grants[1]?.grantID, issued: 1, live: 1, users: 1 },
    ],
    access: { count: 4 },
    clients: [{ name: 'Claude' }, { name: 'Tide almanac' }],
  });
});

test("it records each grant's last use, a revoked grant's tombstone and one passkey", () => {
  const ctx = setupTest();

  const legacy = seedLegacyGrants(
    ctx.dbPath,
    [{ clientName: 'Claude', refreshes: 0 }],
    Date.UTC(2026, 10, 1),
  );

  const sqlite = ctx.openFile();

  expect({
    uses: sqlite.query('select grant_id, last_used_at from pepys_grant_use').all(),
    revoked: sqlite.query('select grant_id from pepys_revoked_grant').all(),
    passkeys: sqlite.query('select id from pepys_passkey').all(),
  }).toStrictEqual({
    uses: [{ grant_id: legacy.grants[0]?.grantID, last_used_at: '2026-11-01T00:00:00.000Z' }],
    revoked: [{ grant_id: legacy.revokedGrantID }],
    passkeys: [{ id: legacy.passkeyID }],
  });
});
