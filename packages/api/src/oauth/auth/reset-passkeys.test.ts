import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { buildSeeder } from '../test-utils/build-seeder.ts';
import { buildStubClock } from '../test-utils/build-stub-clock.ts';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { createEnrollmentToken } from './create-enrollment-token.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readClientViews } from './read-client-views.ts';
import { readEnrollmentTokenHashes } from './read-enrollment-token-hashes.ts';
import { readOwnerSessionViews } from './read-owner-session-views.ts';
import { readPasskeyViews } from './read-passkey-views.ts';
import { resetPasskeys } from './reset-passkeys.ts';
import type { PasskeyID } from './types.ts';

// A temp directory that holds an authorization database, opened the way
// the server opens it.
async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-reset-passkeys-');

  const store = await openMCPAuth({
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    openDatabase: openTestAuthDatabase,
    origin: null,
  });

  registerTestCleanup(() => store.close());

  const deps = { db: store.db, clock: buildStubClock() };

  return { ...deps, auth: store.auth, seed: buildSeeder(deps) };
}

test('it removes every passkey, enrollment token, and browser sign-in', async () => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.seed.passkey({ id: toTagged<PasskeyID>('cred-lost') });

  await createEnrollmentToken(ctx.db, Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.auth.api.signInOwner({ body: {} });

  const signedInBefore = await readOwnerSessionViews(ctx.db);

  invariant(signedInBefore.length === 1, 'the arrangement left no browser sign-in');

  await resetPasskeys(ctx.db);

  const passkeys = await readPasskeyViews(ctx.db);

  expect(passkeys).toBeEmpty();

  const tokenHashes = await readEnrollmentTokenHashes(ctx.db);

  expect(tokenHashes).toBeEmpty();

  const sessions = await readOwnerSessionViews(ctx.db);

  expect(sessions).toBeEmpty();
});

test('it never removes a client', async () => {
  const ctx = await setupTest();

  const created = await ctx.auth.api.createFixedClient({
    body: { name: 'dots', redirectURIs: ['https://dots.example/cb'] },
  });

  await resetPasskeys(ctx.db);

  const clients = await readClientViews(ctx.db);

  expect(clients).toStrictEqual([
    {
      clientID: created.clientID,
      name: 'dots',
      redirectURIs: ['https://dots.example/cb'],
      createdAt: expect.toBeString(),
    },
  ]);
});
