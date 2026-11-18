import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { buildKeyID } from './build-key-id.ts';
import { createIdentity } from './create-identity.ts';
import { signIdentityToken } from './sign-identity-token.ts';

async function setupTest() {
  const folder = await mkdtemp(join(tmpdir(), 'pepys-token-'));

  onTestFinished(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const identity = await createIdentity({
    folder,
    issuer: 'study-pc',
    randomID: () => '5f0c8a52-1d7e-4b3a-9c1f-2e6d7a8b9c10',
  });

  invariant(identity.ok, 'the identity is made');

  return {
    identity: identity.value,
    sign: (nowMs: number, jti: string) =>
      signIdentityToken({
        identity: identity.value,
        audience: 'forwarder.pepys.example',
        nowMs,
        jti,
      }),
    verify: async (token: string) => {
      const [header = '', claims = '', signature = ''] = token.split('.');

      const key = await crypto.subtle.importKey(
        'jwk',
        identity.value.publicKey,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify'],
      );

      return crypto.subtle.verify(
        { name: 'ECDSA', hash: 'SHA-256' },
        key,
        Buffer.from(signature, 'base64url'),
        new TextEncoder().encode(`${header}.${claims}`),
      );
    },
  };
}

test('#signIdentityToken writes the header and the claims of the design, with iat 25 seconds in the past', async () => {
  const ctx = await setupTest();
  const token = await ctx.sign(1_794_355_200_000, 'jti-1');

  const [header = '', claims = ''] = token.split('.');

  expect({
    header: JSON.parse(Buffer.from(header, 'base64url').toString()),
    claims: JSON.parse(Buffer.from(claims, 'base64url').toString()),
  }).toStrictEqual({
    header: { alg: 'ES256', kid: buildKeyID(ctx.identity.publicKey) },
    claims: {
      iss: 'study-pc',
      sub: '5f0c8a52-1d7e-4b3a-9c1f-2e6d7a8b9c10',
      aud: 'forwarder.pepys.example',
      iat: 1_794_355_175,
      exp: 1_794_355_230,
      jti: 'jti-1',
      imp_name: 'study-pc',
    },
  });
});

test('#signIdentityToken signs with a raw 64-byte signature that the public key verifies', async () => {
  const ctx = await setupTest();
  const token = await ctx.sign(1_794_355_200_000, 'jti-1');

  const signature = Buffer.from(token.split('.')[2] ?? '', 'base64url');

  expect({ bytes: signature.length, verified: await ctx.verify(token) }).toStrictEqual({
    bytes: 64,
    verified: true,
  });
});
