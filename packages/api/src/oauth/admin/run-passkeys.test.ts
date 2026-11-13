import { expect, test } from 'bun:test';
import { join } from 'node:path';
import type { PasskeyID } from '@zgeoff/mcp-auth';
import { buildStubAuthenticator, seedPasskey } from '@zgeoff/mcp-auth/testing';
import { toTagged } from '@zgeoff/std';
import invariant from 'tiny-invariant';
import { openSharedAuth } from '../../test-utils/open-shared-auth.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { runPasskeys } from './run-passkeys.ts';
import type { PasskeysAction } from './run-passkeys.ts';

// A database file in a folder the command creates, a second auth core on it
// to seed passkeys and read them back, and every line the command gives.
async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-passkeys-');
  const dbPath = join(temporaryDirectory.path, 'state', 'mcp-auth.db');
  const printed: string[] = [];
  const errors: string[] = [];
  const codes: number[] = [];

  const run = (action: PasskeysAction, command = 'passkeys') =>
    runPasskeys(
      action,
      { dbPath, command },
      {
        print: (line) => {
          printed.push(line);
        },
        printError: (line) => {
          errors.push(line);
        },
        setExitCode: (code) => {
          codes.push(code);
        },
      },
    );

  // The command makes the folder and the tables the second core opens on.
  await runPasskeys(
    { kind: 'list' },
    { dbPath, command: 'passkeys' },
    {
      print: () => {},
      printError: () => {},
      setExitCode: () => {},
    },
  );

  const auth = await openSharedAuth({ origin: 'http://127.0.0.1:8081', dbPath });

  return {
    auth,
    printed,
    errors,
    codes,
    runPasskeys: run,
    seed: { passkey: () => seedPasskey(auth, { authenticator: buildStubAuthenticator() }) },
  };
}

test('it prints an enrollment token the server accepts', async () => {
  const ctx = await setupTest();

  await ctx.runPasskeys({ kind: 'enroll', reset: false });

  const token = /^Enrollment token: (?<token>\S+)$/u.exec(ctx.printed[0] ?? '')?.groups?.['token'];

  const enrolled = await ctx.auth.routes.enroll(
    new Request('http://127.0.0.1:8081/enroll', {
      method: 'POST',
      headers: {
        origin: 'http://127.0.0.1:8081',
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token: token ?? '' }),
    }),
    { socketAddress: null, connectingIP: null, userAgent: null },
  );

  expect({
    hint: ctx.printed[1],
    status: enrolled.status,
    page: await enrolled.text(),
  }).toStrictEqual({
    hint: "It enrolls one passkey and expires soon. Open /enroll on the server's public URL in your browser and type it there.",
    status: 200,
    page: expect.stringContaining('navigator.credentials.create'),
  });
});

test('it keeps the enrolled passkeys when it enrolls without reset', async () => {
  const ctx = await setupTest();

  await ctx.seed.passkey();
  await ctx.runPasskeys({ kind: 'enroll', reset: false });

  expect(ctx.auth.passkeys.list()).resolves.toHaveLength(1);
});

test('it removes every passkey on reset', async () => {
  const ctx = await setupTest();

  await ctx.seed.passkey();
  await ctx.runPasskeys({ kind: 'enroll', reset: true });

  expect({ printed: ctx.printed, passkeys: await ctx.auth.passkeys.list() }).toStrictEqual({
    printed: [
      'Removed every passkey and enrollment token and ended every browser sign-in. Grants stay.',
      expect.toStartWith('Enrollment token: '),
      expect.any(String),
    ],
    passkeys: [],
  });
});

test('it lists each enrolled passkey with when it was enrolled and last used', async () => {
  const ctx = await setupTest();

  await ctx.seed.passkey();

  const [passkey] = await ctx.auth.passkeys.list();

  await ctx.runPasskeys({ kind: 'list' });

  expect(ctx.printed).toStrictEqual([
    `${passkey?.id}  enrolled ${passkey?.createdAt}  last used never`,
  ]);
});

test('it says how to enroll when no passkey is enrolled', async () => {
  const ctx = await setupTest();

  await ctx.runPasskeys({ kind: 'list' }, 'api.ts passkeys');

  expect(ctx.printed).toStrictEqual(['No passkeys. Enroll one with: api.ts passkeys enroll']);
});

test('it removes one passkey and keeps the others', async () => {
  const ctx = await setupTest();

  await ctx.seed.passkey();
  await ctx.seed.passkey();

  const [lost, kept] = await ctx.auth.passkeys.list();

  invariant(lost !== undefined && kept !== undefined, 'the arrangement enrolled two passkeys');

  await ctx.runPasskeys({ kind: 'remove', id: lost.id });

  expect({ printed: ctx.printed, passkeys: await ctx.auth.passkeys.list() }).toStrictEqual({
    printed: [`Removed passkey ${lost.id} and ended every browser sign-in`],
    passkeys: [kept],
  });
});

test('it sets exit code 1 when it removes a passkey that does not exist', async () => {
  const ctx = await setupTest();

  await ctx.runPasskeys({ kind: 'remove', id: toTagged<PasskeyID>('cred-missing') });

  expect({ errors: ctx.errors, codes: ctx.codes }).toStrictEqual({
    errors: ["passkeys remove: no passkey has the ID 'cred-missing'"],
    codes: [1],
  });
});
