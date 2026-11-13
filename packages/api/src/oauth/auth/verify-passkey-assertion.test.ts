import { expect, test } from 'bun:test';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { buildSeeder } from '../test-utils/build-seeder.ts';
import { buildStubAuthenticator } from '../test-utils/build-stub-authenticator.ts';
import { buildStubClock } from '../test-utils/build-stub-clock.ts';
import { openTestAuthDatabase } from '../test-utils/open-test-auth-database.ts';
import { registerTestCleanup } from '../test-utils/register-test-cleanup.ts';
import { setupTempDir } from '../test-utils/setup-temp-dir.ts';
import { openMCPAuth } from './open-mcp-auth.ts';
import { readPasskey } from './read-passkey.ts';
import { verifyPasskeyAssertion } from './verify-passkey-assertion.ts';
import { verifyPasskeyRegistration } from './verify-passkey-registration.ts';

// An authorization database, opened the way the server opens it, and the
// credential that `authenticator` registered for the RP ID `pepys.example`.
async function setupTest() {
  const temporaryDirectory = setupTempDir('pepys-verify-passkey-assertion-');

  const store = await openMCPAuth({
    dbPath: join(temporaryDirectory.path, 'mcp-auth.db'),
    openDatabase: openTestAuthDatabase,
    origin: null,
  });

  registerTestCleanup(() => store.close());

  const authenticator = buildStubAuthenticator();

  const registration = await authenticator.create(
    { challenge: 'ZW5yb2xs', rp: { id: 'pepys.example' }, user: { id: 'YXRjLW93bmVy' } },
    { origin: 'https://pepys.example' },
  );

  const registered = await verifyPasskeyRegistration({
    credential: JSON.stringify(registration),
    challenge: 'ZW5yb2xs',
    origin: 'https://pepys.example',
    rpID: 'pepys.example',
  });

  invariant(registered !== null, 'the passkey did not register');

  const deps = { db: store.db, clock: buildStubClock() };

  return {
    ...deps,
    authenticator,
    credential: {
      id: registered.id,
      publicKey: Buffer.from(registered.publicKey).toString('base64url'),
      counter: registered.counter,
    },
    seed: buildSeeder(deps),
  };
}

test('it returns the id of the enrolled passkey an assertion verifies against and stores its counter and use', async () => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.seed.passkey(ctx.credential);

  const assertion = await ctx.authenticator.signAssertion(
    { challenge: 'c2lnbi1pbg', rpId: 'pepys.example' },
    { origin: 'https://pepys.example' },
  );

  const verified = await verifyPasskeyAssertion(ctx.db, {
    credential: JSON.stringify(assertion),
    challenge: 'c2lnbi1pbg',
    origin: 'https://pepys.example',
    rpID: 'pepys.example',
    now: Date.UTC(2026, 9, 14, 13, 0, 0),
  });

  expect(verified).toBe(ctx.authenticator.credentialID);

  const passkey = await readPasskey(ctx.db, ctx.authenticator.credentialID);

  expect(passkey).toStrictEqual({
    id: ctx.authenticator.credentialID,
    publicKey: ctx.credential.publicKey,
    counter: 1,
    transports: expect.toBeString(),
    lastUsedAt: '2026-10-14T13:00:00.000Z',
  });
});

test.each([
  ['another challenge', { challenge: 'b3RoZXI' }, {}],
  ['another origin', {}, { origin: 'https://elsewhere.example' }],
  ['another RP ID', {}, { rpID: 'elsewhere.example' }],
  ['an unverified user', {}, { userVerified: false }],
])('it refuses an assertion made for %s', async (_label, expected, ceremony) => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.seed.passkey(ctx.credential);

  const assertion = await ctx.authenticator.signAssertion(
    { challenge: 'c2lnbi1pbg', rpId: 'pepys.example' },
    { origin: 'https://pepys.example', ...ceremony },
  );

  const verified = await verifyPasskeyAssertion(ctx.db, {
    credential: JSON.stringify(assertion),
    challenge: 'c2lnbi1pbg',
    origin: 'https://pepys.example',
    rpID: 'pepys.example',
    now: Date.UTC(2026, 9, 14, 13, 0, 0),
    ...expected,
  });

  expect(verified).toBeNull();
});

test('it refuses an assertion from a passkey that is not enrolled', async () => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.seed.passkey(ctx.credential);

  const stranger = buildStubAuthenticator();

  await stranger.create(
    { challenge: 'ZW5yb2xs', rp: { id: 'pepys.example' }, user: { id: 'YXRjLW93bmVy' } },
    { origin: 'https://pepys.example' },
  );

  const assertion = await stranger.signAssertion(
    { challenge: 'c2lnbi1pbg', rpId: 'pepys.example' },
    { origin: 'https://pepys.example' },
  );

  const verified = await verifyPasskeyAssertion(ctx.db, {
    credential: JSON.stringify(assertion),
    challenge: 'c2lnbi1pbg',
    origin: 'https://pepys.example',
    rpID: 'pepys.example',
    now: Date.UTC(2026, 9, 14, 13, 0, 0),
  });

  expect(verified).toBeNull();
});

test("it refuses an assertion signed by another key under the enrolled passkey's id", async () => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.seed.passkey(ctx.credential);

  const forger = buildStubAuthenticator();

  await forger.create(
    { challenge: 'ZW5yb2xs', rp: { id: 'pepys.example' }, user: { id: 'YXRjLW93bmVy' } },
    { origin: 'https://pepys.example' },
  );

  const forged = await forger.signAssertion(
    { challenge: 'c2lnbi1pbg', rpId: 'pepys.example' },
    { origin: 'https://pepys.example' },
  );

  const verified = await verifyPasskeyAssertion(ctx.db, {
    credential: JSON.stringify({
      ...forged,
      id: ctx.authenticator.credentialID,
      rawId: ctx.authenticator.credentialID,
    }),
    challenge: 'c2lnbi1pbg',
    origin: 'https://pepys.example',
    rpID: 'pepys.example',
    now: Date.UTC(2026, 9, 14, 13, 0, 0),
  });

  expect(verified).toBeNull();
});

test('it refuses an assertion whose counter does not pass the stored one', async () => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.seed.passkey({ ...ctx.credential, counter: 5 });

  const assertion = await ctx.authenticator.signAssertion(
    { challenge: 'c2lnbi1pbg', rpId: 'pepys.example' },
    { origin: 'https://pepys.example' },
  );

  const verified = await verifyPasskeyAssertion(ctx.db, {
    credential: JSON.stringify(assertion),
    challenge: 'c2lnbi1pbg',
    origin: 'https://pepys.example',
    rpID: 'pepys.example',
    now: Date.UTC(2026, 9, 14, 13, 0, 0),
  });

  expect(verified).toBeNull();
});

test.each([['not json'], ['{}'], ['{"id":"x","rawId":"x","type":"public-key","response":{}}']])(
  'it refuses the malformed credential %p',
  async (credential) => {
    const ctx = await setupTest();

    ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

    await ctx.seed.passkey(ctx.credential);

    const verified = await verifyPasskeyAssertion(ctx.db, {
      credential,
      challenge: 'c2lnbi1pbg',
      origin: 'https://pepys.example',
      rpID: 'pepys.example',
      now: Date.UTC(2026, 9, 14, 13, 0, 0),
    });

    expect(verified).toBeNull();
  },
);

test('it passes only one of two assertions checked at once against the same stored counter', async () => {
  const ctx = await setupTest();

  ctx.clock.setTime(Date.UTC(2026, 9, 14, 12, 0, 0));

  await ctx.seed.passkey(ctx.credential);

  const first = await ctx.authenticator.signAssertion(
    { challenge: 'Zmlyc3Q', rpId: 'pepys.example' },
    { origin: 'https://pepys.example' },
  );

  const second = await ctx.authenticator.signAssertion(
    { challenge: 'c2Vjb25k', rpId: 'pepys.example' },
    { origin: 'https://pepys.example' },
  );

  const results = await Promise.all([
    verifyPasskeyAssertion(ctx.db, {
      credential: JSON.stringify(first),
      challenge: 'Zmlyc3Q',
      origin: 'https://pepys.example',
      rpID: 'pepys.example',
      now: Date.UTC(2026, 9, 14, 13, 0, 0),
    }),
    verifyPasskeyAssertion(ctx.db, {
      credential: JSON.stringify(second),
      challenge: 'c2Vjb25k',
      origin: 'https://pepys.example',
      rpID: 'pepys.example',
      now: Date.UTC(2026, 9, 14, 13, 0, 0),
    }),
  ]);

  expect(results.filter((id) => id !== null)).toBeArrayOfSize(1);
});
