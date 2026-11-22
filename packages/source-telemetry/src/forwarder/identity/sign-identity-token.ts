import type { Identity } from './types.ts';

interface TokenInput {
  identity: Identity;
  audience: string;
  nowMs: number;
  jti: string;
}

// How far the token's `iat` lies in the past, so that a machine clock a little ahead of ingest's
// still passes, and the longest life that the verifier takes.
const issuedAtShiftSeconds = 25;
const tokenLifeSeconds = 55;

// One compact ES256 token. The signature is the 64-byte `r || s` form that WebCrypto returns.
export async function signIdentityToken(input: TokenInput): Promise<string> {
  const issuedAt = Math.floor(input.nowMs / 1000) - issuedAtShiftSeconds;
  const header = { alg: 'ES256', kid: input.identity.kid };

  const claims = {
    iss: input.identity.issuer,
    sub: input.identity.id,
    aud: input.audience,
    iat: issuedAt,
    exp: issuedAt + tokenLifeSeconds,
    jti: input.jti,
    imp_name: input.identity.issuer,
  };

  const signingInput = `${encodeSegment(header)}.${encodeSegment(claims)}`;

  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    input.identity.privateKey,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${Buffer.from(signature).toString('base64url')}`;
}

function encodeSegment(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
