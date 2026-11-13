import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { createEnrollmentToken } from './create-enrollment-token.ts';
import { deriveTokenHash } from './derive-token-hash.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readEnrollmentTokenHashes } from './read-enrollment-token-hashes.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-read-enrollment-token-hashes-');

  const store = await openMCPAuth({
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    openDatabase: openTestAuthDatabase,
    origin: null,
  });

  registerTestCleanup(() => store.close());

  return { db: store.db };
}

test('it reads the hash of every stored token, an expired one included', async () => {
  const ctx = await setupTest();
  const expired = await createEnrollmentToken(ctx.db, Date.UTC(2026, 9, 1, 12, 0, 0));
  const live = await createEnrollmentToken(ctx.db, Date.UTC(2026, 9, 14, 12, 0, 0));
  const hashes = await readEnrollmentTokenHashes(ctx.db);

  expect(hashes).toStrictEqual(
    [deriveTokenHash(expired.token), deriveTokenHash(live.token)].toSorted(),
  );
});

test('it reads no hash from a database with no token', async () => {
  const ctx = await setupTest();

  expect(readEnrollmentTokenHashes(ctx.db)).resolves.toStrictEqual([]);
});
