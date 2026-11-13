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

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-read-passkey-');

  const store = await openMCPAuth({
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    openDatabase: openTestAuthDatabase,
    origin: null,
  });

  registerTestCleanup(() => store.close());

  const deps = { db: store.db, clock: buildStubClock() };

  return { ...deps, seed: buildSeeder(deps) };
}

test('it reads a passkey with its key, counter, transports and last use', async () => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.seed.passkey({
    id: toTagged<PasskeyID>('cred-phone'),
    publicKey: 'AQID',
    counter: 7,
    transports: ['internal'],
  });

  const passkey = await readPasskey(ctx.db, toTagged<PasskeyID>('cred-phone'));

  expect(passkey).toStrictEqual({
    id: toTagged<PasskeyID>('cred-phone'),
    publicKey: 'AQID',
    counter: 7,
    transports: '["internal"]',
    lastUsedAt: null,
  });
});

test('it reads no passkey for an unknown id', async () => {
  const ctx = await setupTest();

  expect(readPasskey(ctx.db, toTagged<PasskeyID>('cred-gone'))).resolves.toBeNull();
});
