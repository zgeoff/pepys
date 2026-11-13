import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { buildSeeder } from '../test-utils/build-seeder.ts';
import { buildStubClock } from '../test-utils/build-stub-clock.ts';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readOwnerSessionViews } from './read-owner-session-views.ts';
import { readPasskeyViews } from './read-passkey-views.ts';
import { removePasskey } from './remove-passkey.ts';
import type { PasskeyID } from './types.ts';

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

  const deps = { db: store.db, clock: buildStubClock() };

  return { ...deps, auth: store.auth, seed: buildSeeder(deps) };
}

test('it removes the passkey and every browser sign-in', async () => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.seed.passkey({ id: toTagged<PasskeyID>('cred-lost') });
  await ctx.seed.passkey({ id: toTagged<PasskeyID>('cred-kept') });
  await ctx.auth.api.signInOwner({ body: {} });

  const signedInBefore = await readOwnerSessionViews(ctx.db);

  invariant(signedInBefore.length === 1, 'the arrangement left no browser sign-in');

  const removed = await removePasskey(ctx.db, toTagged<PasskeyID>('cred-lost'));

  expect(removed).toBeTrue();

  const passkeys = await readPasskeyViews(ctx.db);

  expect(passkeys).toStrictEqual([
    {
      id: toTagged<PasskeyID>('cred-kept'),
      createdAt: '2026-10-14T12:00:00.000Z',
      lastUsedAt: null,
    },
  ]);

  const sessions = await readOwnerSessionViews(ctx.db);

  expect(sessions).toBeEmpty();
});

test('it removes nothing and keeps every browser sign-in for an unknown passkey', async () => {
  const ctx = await setupTest();

  await ctx.auth.api.signInOwner({ body: {} });

  const removed = await removePasskey(ctx.db, toTagged<PasskeyID>('cred-missing'));

  expect(removed).toBeFalse();

  const sessions = await readOwnerSessionViews(ctx.db);

  expect(sessions).toBeArrayOfSize(1);
});
