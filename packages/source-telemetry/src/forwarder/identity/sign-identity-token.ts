import type { Identity } from './types.ts';

// How far the token's `iat` lies in the past, so that a machine clock a little ahead of ingest's
// still passes, and the longest life that the verifier takes.
export const issuedAtShiftSeconds = 25;
export const tokenLifeSeconds = 55;

interface TokenInput {
  identity: Identity;
  audience: string;
  nowMs: number;
  jti: string;
}

export function buildTokenParts(input: TokenInput) {
  const issuedAt = Math.floor(input.nowMs / 1000) - issuedAtShiftSeconds;

  return {
    header: { alg: 'ES256', kid: input.identity.kid },
    claims: {
      iss: input.identity.issuer,
      sub: input.identity.id,
      aud: input.audience,
      iat: issuedAt,
      exp: issuedAt + tokenLifeSeconds,
      jti: input.jti,
      imp_name: input.identity.issuer,
    },
  };
}

// One compact ES256 token. The signature is the 64-byte `r || s` form that WebCrypto returns.
export async function signIdentityToken(input: TokenInput): Promise<string> {
  const parts = buildTokenParts(input);
  const signingInput = `${encodeSegment(parts.header)}.${encodeSegment(parts.claims)}`;

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
