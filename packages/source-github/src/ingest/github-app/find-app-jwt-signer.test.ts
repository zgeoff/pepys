import { expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { findAppJWTSigner } from './find-app-jwt-signer.ts';

test('it reads the clock once for each JWT, and never before the first', () => {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const readTimes: number[] = [];

  const signAppJWT = findAppJWTSigner(
    {
      PEPYS_GITHUB_APP_ID: '4242',
      PEPYS_GITHUB_APP_PRIVATE_KEY: keys.privateKey.export({ type: 'pkcs1', format: 'pem' }),
    },
    () => {
      readTimes.push(1_800_000_000_000 + readTimes.length * 60_000);

      return readTimes.at(-1) ?? 0;
    },
  );

  const readsBeforeFirst = readTimes.length;

  const claims = [signAppJWT?.(), signAppJWT?.()].map((jwt): unknown =>
    JSON.parse(Buffer.from(jwt?.split('.')[1] ?? '', 'base64url').toString('utf8')),
  );

  expect(readsBeforeFirst).toBe(0);

  expect(claims).toStrictEqual([
    { iat: 1_799_999_940, exp: 1_800_000_540, iss: '4242' },
    { iat: 1_800_000_000, exp: 1_800_000_600, iss: '4242' },
  ]);
});

test('it finds no signer for a key that cannot sign', () => {
  const signAppJWT = findAppJWTSigner(
    { PEPYS_GITHUB_APP_ID: '4242', PEPYS_GITHUB_APP_PRIVATE_KEY: 'not a key' },
    () => 1_800_000_000_000,
  );

  expect(signAppJWT).toBeUndefined();
});
