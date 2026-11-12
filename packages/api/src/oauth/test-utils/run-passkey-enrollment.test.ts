import { expect, test } from 'bun:test';
import { join } from 'node:path';
import { startHarbourMCPServer } from '../../test-utils/start-harbour-mcp-server.ts';
import { openMCPAuthDatabase } from '../admin/open-mcp-auth-database.ts';
import { createEnrollmentToken } from '../auth/create-enrollment-token.ts';
import { openMCPAuth } from '../auth/open-mcp-auth.ts';
import { readPasskeyViews } from '../auth/read-passkey-views.ts';
import { buildStubAuthenticator } from './build-stub-authenticator.ts';
import { registerTestCleanup } from './register-test-cleanup.ts';
import { runPasskeyEnrollment } from './run-passkey-enrollment.ts';
import { setupTempDir } from './setup-temp-dir.ts';

async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-run-passkey-enrollment-');
  const dbPath = join(temporaryDirectory.path, 'mcp-auth.db');

  const server = await startHarbourMCPServer({
    dbPath,
  });

  const store = await openMCPAuth({ dbPath, openDatabase: openMCPAuthDatabase, origin: null });

  registerTestCleanup(() => store.close());

  return { url: server.url, origin: server.origin, store };
}

test("it enrolls the authenticator's passkey with the token", async () => {
  const ctx = await setupTest();

  const authenticator = buildStubAuthenticator();

  const enrollment = await createEnrollmentToken(ctx.store.db, Date.now());

  await runPasskeyEnrollment(ctx, enrollment.token, authenticator);

  const passkeys = await readPasskeyViews(ctx.store.db);

  expect(passkeys).toStrictEqual([
    { id: authenticator.credentialID, createdAt: expect.toBeString(), lastUsedAt: null },
  ]);
});

test('it throws when the token does not reach the passkey prompt', async () => {
  const ctx = await setupTest();

  const enrolling = runPasskeyEnrollment(ctx, 'pepys-enroll-unknown', buildStubAuthenticator());

  expect(enrolling).rejects.toThrowWithMessage(
    Error,
    'the enrollment token did not reach the passkey prompt: 400',
  );
});

test('it throws when the passkey does not enroll', async () => {
  const ctx = await setupTest();
  const enrollment = await createEnrollmentToken(ctx.store.db, Date.now());

  const enrolling = runPasskeyEnrollment(ctx, enrollment.token, {
    create: (options) =>
      buildStubAuthenticator().create(options, { origin: 'https://elsewhere.example' }),
  });

  expect(enrolling).rejects.toThrowWithMessage(Error, /^the passkey did not enroll: 400 /u);
});
