import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { openMCPAuth } from '../auth/open-mcp-auth.ts';
import { buildStubAuthenticator } from './build-stub-authenticator.ts';
import { buildStubClock } from './build-stub-clock.ts';
import { openTestAuthDatabase } from './open-test-auth-database.ts';
import { registerTestCleanup } from './register-test-cleanup.ts';
import { seedEnrolledPasskey } from './seed-enrolled-passkey.ts';
import { setupTempDir } from './setup-temp-dir.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-seed-enrolled-passkey-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');
  const clock = buildStubClock();

  const server = await startHarbourMCPServer({
    dbPath,
    openAuthDatabase: openTestAuthDatabase,
    clock,
  });

  const store = await openMCPAuth({ dbPath, openDatabase: openTestAuthDatabase, origin: null });

  registerTestCleanup(() => store.close());

  return { db: store.db, clock, server };
}

test('it writes the passkey of the authenticator, and spends the token it enrolled with', async () => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.now());

  const authenticator = buildStubAuthenticator();

  await seedEnrolledPasskey(ctx, { authenticator });

  expect(ctx.db.selectFrom('pepys_passkey').selectAll().execute()).resolves.toMatchObject([
    { id: authenticator.credentialID, counter: 0, last_used_at: null },
  ]);

  expect(ctx.db.selectFrom('pepys_enrollment_token').selectAll().execute()).resolves.toStrictEqual(
    [],
  );
});
