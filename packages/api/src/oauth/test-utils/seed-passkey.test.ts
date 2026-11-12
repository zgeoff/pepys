import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { openMCPAuth } from '../auth/open-mcp-auth.ts';
import { buildStubClock } from './build-stub-clock.ts';
import { openTestAuthDatabase } from './open-test-auth-database.ts';
import { registerTestCleanup } from './register-test-cleanup.ts';
import { seedPasskey } from './seed-passkey.ts';
import { setupTempDir } from './setup-temp-dir.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-seed-passkey-');

  const store = await openMCPAuth({
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    openDatabase: openTestAuthDatabase,
    origin: null,
  });

  registerTestCleanup(() => store.close());

  return { db: store.db, clock: buildStubClock(Date.UTC(2026, 9, 14, 12, 0, 0)) };
}

test('it writes a passkey enrolled at the clock time, and spends the token it enrolled with', async () => {
  const ctx = await setupTest();

  await seedPasskey(ctx, { id: 'cred-phone' });

  expect(ctx.db.selectFrom('pepys_passkey').selectAll().execute()).resolves.toMatchObject([
    { id: 'cred-phone', created_at: '2026-10-14T12:00:00.000Z', last_used_at: null },
  ]);

  expect(ctx.db.selectFrom('pepys_enrollment_token').selectAll().execute()).resolves.toStrictEqual(
    [],
  );
});

test('it writes the input over the defaults', async () => {
  const ctx = await setupTest();

  await seedPasskey(ctx, {
    id: 'cred-laptop',
    publicKey: 'BAUG',
    counter: 3,
    transports: ['usb'],
    now: Date.UTC(2026, 9, 14, 12, 30, 0),
  });

  expect(ctx.db.selectFrom('pepys_passkey').selectAll().execute()).resolves.toMatchObject([
    {
      id: 'cred-laptop',
      public_key: 'BAUG',
      counter: 3,
      transports: '["usb"]',
      created_at: '2026-10-14T12:30:00.000Z',
    },
  ]);
});
