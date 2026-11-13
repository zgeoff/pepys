import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { toTagged } from '@zgeoff/std';
import { buildSeeder } from '../test-utils/build-seeder.ts';
import { buildStubClock } from '../test-utils/build-stub-clock.ts';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readPasskey } from './read-passkey.ts';
import type { PasskeyID } from './types.ts';
import { updatePasskeyUse } from './update-passkey-use.ts';

// A temp directory that holds an authorization database, opened the way
// the server opens it.
async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-update-passkey-use-');

  const store = await openMCPAuth({
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    openDatabase: openTestAuthDatabase,
    origin: null,
  });

  registerTestCleanup(() => store.close());

  const deps = { db: store.db, clock: buildStubClock() };

  return { ...deps, seed: buildSeeder(deps) };
}

test('it stores the new counter and the time of the use', async () => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.seed.passkey({ id: toTagged<PasskeyID>('cred-phone'), counter: 4 });

  const stored = await updatePasskeyUse(ctx.db, {
    id: toTagged<PasskeyID>('cred-phone'),
    counter: 4,
    newCounter: 5,
    now: Date.UTC(2026, 9, 14, 13, 0, 0),
  });

  expect(stored).toBeTrue();

  expect(readPasskey(ctx.db, toTagged<PasskeyID>('cred-phone'))).resolves.toStrictEqual({
    id: toTagged<PasskeyID>('cred-phone'),
    publicKey: expect.toBeString(),
    counter: 5,
    transports: expect.toBeString(),
    lastUsedAt: '2026-10-14T13:00:00.000Z',
  });
});

test('it stores nothing when the passkey holds another counter than the verification read', async () => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.seed.passkey({ id: toTagged<PasskeyID>('cred-phone'), counter: 6 });

  const stored = await updatePasskeyUse(ctx.db, {
    id: toTagged<PasskeyID>('cred-phone'),
    counter: 4,
    newCounter: 5,
    now: Date.UTC(2026, 9, 14, 13, 0, 0),
  });

  expect(stored).toBeFalse();

  expect(readPasskey(ctx.db, toTagged<PasskeyID>('cred-phone'))).resolves.toStrictEqual({
    id: toTagged<PasskeyID>('cred-phone'),
    publicKey: expect.toBeString(),
    counter: 6,
    transports: expect.toBeString(),
    lastUsedAt: null,
  });
});

test('it stores nothing for a passkey that is no longer enrolled', async () => {
  const ctx = await setupTest();

  expect(
    updatePasskeyUse(ctx.db, {
      id: toTagged<PasskeyID>('cred-gone'),
      counter: 0,
      newCounter: 1,
      now: 0,
    }),
  ).resolves.toBeFalse();
});
