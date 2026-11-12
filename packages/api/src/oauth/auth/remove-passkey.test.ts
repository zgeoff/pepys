import { expect, test } from 'bun:test';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { buildSeeder } from '../test-utils/build-seeder.ts';
import { buildStubClock } from '../test-utils/build-stub-clock.ts';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { removePasskey } from './remove-passkey.ts';

// A temp directory that holds an authorization database, opened the way
// the server opens it.
async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-remove-passkey-');

  const store = await openMCPAuth({
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    openDatabase: openTestAuthDatabase,
    origin: null,
  });

  registerTestCleanup(() => store.close());

  const deps = { db: store.db, clock: buildStubClock(Date.UTC(2026, 9, 14, 12, 0, 0)) };

  return { ...deps, auth: store.auth, seed: buildSeeder(deps) };
}

test('it removes the passkey and every browser sign-in', async () => {
  const ctx = await setupTest();

  await ctx.seed.passkey({ id: 'cred-lost' });
  await ctx.seed.passkey({ id: 'cred-kept' });
  await ctx.auth.api.signInOwner({ body: {} });

  const signedInBefore = await ctx.db.selectFrom('session').select('id').execute();

  invariant(signedInBefore.length === 1, 'the arrangement left no browser sign-in');

  const removed = await removePasskey(ctx.db, 'cred-lost');

  expect(removed).toBeTrue();

  const passkeyRows = await ctx.db.selectFrom('pepys_passkey').select('id').execute();

  expect(passkeyRows).toStrictEqual([{ id: 'cred-kept' }]);

  const sessions = await ctx.db.selectFrom('session').select('id').execute();

  expect(sessions).toBeEmpty();
});

test('it removes nothing and keeps every browser sign-in for an unknown passkey', async () => {
  const ctx = await setupTest();

  await ctx.auth.api.signInOwner({ body: {} });

  const removed = await removePasskey(ctx.db, 'cred-missing');

  expect(removed).toBeFalse();

  const sessions = await ctx.db.selectFrom('session').select('id').execute();

  expect(sessions).toBeArrayOfSize(1);
});
