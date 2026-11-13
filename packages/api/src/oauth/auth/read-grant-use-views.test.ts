import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { toTagged } from '@zgeoff/std';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readGrantUseViews } from './read-grant-use-views.ts';
import type { OAuthGrantID } from './types.ts';
import { writeGrantUse } from './write-grant-use.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-read-grant-uses-');

  const store = await openMCPAuth({
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    openDatabase: openTestAuthDatabase,
    origin: null,
  });

  registerTestCleanup(() => store.close());

  return { db: store.db };
}

test('it reads every grant use, with no grant behind it, in grant order', async () => {
  const ctx = await setupTest();

  await writeGrantUse(ctx.db, toTagged<OAuthGrantID>('grant-b'), Date.UTC(2026, 9, 8, 0, 0, 0));
  await writeGrantUse(ctx.db, toTagged<OAuthGrantID>('grant-a'), Date.UTC(2026, 9, 9, 0, 0, 0));

  const uses = await readGrantUseViews(ctx.db);

  expect(uses).toStrictEqual([
    { grantID: toTagged<OAuthGrantID>('grant-a'), lastUsedAt: '2026-10-09T00:00:00.000Z' },
    { grantID: toTagged<OAuthGrantID>('grant-b'), lastUsedAt: '2026-10-08T00:00:00.000Z' },
  ]);
});

test('it reads no grant use from a database with none', async () => {
  const ctx = await setupTest();

  expect(readGrantUseViews(ctx.db)).resolves.toStrictEqual([]);
});
