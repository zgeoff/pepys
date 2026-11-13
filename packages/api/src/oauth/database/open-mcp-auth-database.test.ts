import { expect, test } from 'bun:test';
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PATHS, openMCPAuth } from '@zgeoff/mcp-auth';
import { buildTestRequester } from '@zgeoff/mcp-auth/testing';
import invariant from 'tiny-invariant';
import { AUTH_TABLES } from '../auth-tables.ts';
import { GRANT_SCOPES } from '../constants.ts';
import { readJSONRecord } from '../test-utils/read-json-record.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { seedLegacyGrants } from '../test-utils/seed-legacy-grants.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { openMCPAuthDatabase } from './open-mcp-auth-database.ts';

// A temp folder for the database file, an opener that closes what it opens
// when the test ends, and the auth core over an opened file at the origin
// the legacy tokens name.
function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-mcp-auth-database-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  const openDatabase = (now: number) => {
    const sqlite = openMCPAuthDatabase(dbPath, now);

    registerTestCleanup(() => {
      sqlite.close();
    });

    return sqlite;
  };

  return {
    dbPath,
    openDatabase,
    openAuth: async (now: number) => {
      const auth = await openMCPAuth({
        database: openDatabase(now),
        origin: 'http://127.0.0.1:8081',
        productName: 'pepys',
        scopes: GRANT_SCOPES,
        paths: DEFAULT_PATHS,
        tables: AUTH_TABLES,
        clock: { now: () => now },
        security: { record: () => {} },
        onGrantRevoked: () => {},
      });

      registerTestCleanup(() => auth.close());

      return auth;
    },
  };
}

test('it opens the database with foreign keys enforced', () => {
  const ctx = setupTest();
  const sqlite = ctx.openDatabase(Date.now());

  expect(sqlite.query('PRAGMA foreign_keys').get()).toStrictEqual({ foreign_keys: 1 });
});

test('it opens the database to wait for another process lock before failing', () => {
  const ctx = setupTest();
  const sqlite = ctx.openDatabase(Date.now());

  expect(sqlite.query('PRAGMA busy_timeout').get()).toStrictEqual({ timeout: 5000 });
});

test('it creates the database file readable by its owner alone', () => {
  const ctx = setupTest();

  ctx.openDatabase(Date.now());

  expect(statSync(ctx.dbPath).mode & 0o777).toBe(0o600);
});

test('it keeps both access tokens of two legacy grants, one refreshed twice, working', async () => {
  const ctx = setupTest();
  const now = Date.now();

  const legacy = seedLegacyGrants(
    ctx.dbPath,
    [
      { clientName: 'Claude', refreshes: 2 },
      { clientName: 'Tide almanac', refreshes: 0 },
    ],
    now,
  );

  const auth = await ctx.openAuth(now);
  const verified = await Promise.all(legacy.grants.map((grant) => auth.verify(grant.accessToken)));

  expect(verified).toStrictEqual(
    legacy.grants.map((grant, index) => ({
      kind: 'oauth',
      grantID: grant.grantID,
      clientID: grant.clientID,
      clientName: index === 0 ? 'Claude' : 'Tide almanac',
      scopes: ['read'],
      limits: null,
    })),
  );
});

test('it ends only the revoked grant of two migrated grants', async () => {
  const ctx = setupTest();
  const now = Date.now();

  const legacy = seedLegacyGrants(
    ctx.dbPath,
    [
      { clientName: 'Claude', refreshes: 1 },
      { clientName: 'Tide almanac', refreshes: 0 },
    ],
    now,
  );

  const [refreshed, other] = legacy.grants;

  const auth = await ctx.openAuth(now);

  invariant(refreshed !== undefined && other !== undefined, 'the arrangement seeded two grants');

  await auth.grants.revoke(refreshed.grantID);

  const verified = {
    revoked: await auth.verify(refreshed.accessToken),
    other: await auth.verify(other.accessToken),
  };

  expect(verified).toStrictEqual({
    revoked: null,
    other: expect.objectContaining({ grantID: other.grantID }),
  });
});

test('it refreshes a migrated grant with its refresh token', async () => {
  const ctx = setupTest();
  const now = Date.now();
  const legacy = seedLegacyGrants(ctx.dbPath, [{ clientName: 'Claude', refreshes: 1 }], now);
  const [grant] = legacy.grants;

  invariant(grant !== undefined, 'the arrangement seeded a grant');

  const auth = await ctx.openAuth(now);

  const refreshed = await auth.routes.token(
    new Request('http://127.0.0.1:8081/oauth2/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: grant.refreshToken,
        client_id: grant.clientID,
      }),
    }),
    buildTestRequester(),
  );

  const tokens = await readJSONRecord(refreshed);

  expect(auth.verify(String(tokens['access_token']))).resolves.toMatchObject({
    grantID: grant.grantID,
  });
});

test('it lists each live legacy grant once, with its last use, and not the revoked one', async () => {
  const ctx = setupTest();
  const now = Date.now();

  const legacy = seedLegacyGrants(
    ctx.dbPath,
    [
      { clientName: 'Claude', refreshes: 2 },
      { clientName: 'Tide almanac', refreshes: 0 },
    ],
    now,
  );

  const auth = await ctx.openAuth(now);

  expect(auth.grants.list()).resolves.toIncludeSameMembers(
    legacy.grants.map((grant) => ({
      grantID: grant.grantID,
      clientID: grant.clientID,
      clientName: expect.toBeString(),
      scopes: ['read'],
      approvedBy: 'passkey',
      createdAt: new Date(now).toISOString(),
      lastUsedAt: new Date(now).toISOString(),
    })),
  );
});

test('it keeps the passkeys and clients where they were', async () => {
  const ctx = setupTest();
  const now = Date.now();
  const legacy = seedLegacyGrants(ctx.dbPath, [{ clientName: 'Claude', refreshes: 0 }], now);

  const auth = await ctx.openAuth(now);
  const passkeys = await auth.passkeys.list();
  const clients = await auth.clients.list();

  expect({
    passkeys: passkeys.map((passkey) => passkey.id),
    clients: clients.map((client) => client.name),
  }).toStrictEqual({ passkeys: [legacy.passkeyID], clients: ['Claude'] });
});

test('it leaves no foreign key pointing nowhere and drops the owner and pepys grant tables', () => {
  const ctx = setupTest();
  const now = Date.now();

  seedLegacyGrants(ctx.dbPath, [{ clientName: 'Claude', refreshes: 1 }], now);

  const sqlite = ctx.openDatabase(now);

  expect({
    broken: sqlite.query('PRAGMA foreign_key_check').all(),
    owners: sqlite.query(`select id from "user" where email = 'owner@pepys.invalid'`).all(),
    tables: sqlite
      .query(
        `select name from sqlite_master where name in ('pepys_grant_use', 'pepys_revoked_grant') or type = 'trigger'`,
      )
      .all(),
  }).toStrictEqual({ broken: [], owners: [], tables: [] });
});

test('it drops the tokens of a grant whose tokens all expired', async () => {
  const ctx = setupTest();
  const now = Date.now();
  const legacy = seedLegacyGrants(ctx.dbPath, [{ clientName: 'Claude', refreshes: 0 }], now);

  const auth = await ctx.openAuth(now + 31 * 24 * 60 * 60_000);

  expect({
    grants: await auth.grants.list(),
    access: await auth.verify(legacy.grants[0]?.accessToken ?? ''),
  }).toStrictEqual({ grants: [], access: null });
});
