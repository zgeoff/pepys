import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { toTagged } from '@zgeoff/std';
import { buildSeeder } from '../test-utils/build-seeder.ts';
import { buildStubClock } from '../test-utils/build-stub-clock.ts';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readPasskeyViews } from './read-passkey-views.ts';
import type { PasskeyID } from './types.ts';
import { updatePasskeyUse } from './update-passkey-use.ts';

// A temp directory that holds an authorization database, opened the way
// the server opens it.
async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-collect-passkeys-');

  const store = await openMCPAuth({
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    openDatabase: openTestAuthDatabase,
    origin: null,
  });

  registerTestCleanup(() => store.close());

  const deps = { db: store.db, clock: buildStubClock() };

  return { ...deps, auth: store.auth, seed: buildSeeder(deps) };
}

test('it lists the passkeys oldest first', async () => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.seed.passkey({
    id: toTagged<PasskeyID>('cred-new'),
    counter: 3,
    now: Date.UTC(2026, 9, 14, 13, 0, 0),
  });

  await ctx.seed.passkey({ id: toTagged<PasskeyID>('cred-old') });

  await updatePasskeyUse(ctx.db, {
    id: toTagged<PasskeyID>('cred-new'),
    counter: 3,
    newCounter: 4,
    now: Date.UTC(2026, 9, 14, 14, 0, 0),
  });

  const passkeys = await readPasskeyViews(ctx.db);

  expect(passkeys).toStrictEqual([
    {
      id: toTagged<PasskeyID>('cred-old'),
      createdAt: '2026-10-14T12:00:00.000Z',
      lastUsedAt: null,
    },
    {
      id: toTagged<PasskeyID>('cred-new'),
      createdAt: '2026-10-14T13:00:00.000Z',
      lastUsedAt: '2026-10-14T14:00:00.000Z',
    },
  ]);
});

test('it lists nothing when no passkey is enrolled', async () => {
  const ctx = await setupTest();
  const passkeys = await readPasskeyViews(ctx.db);

  expect(passkeys).toStrictEqual([]);
});
