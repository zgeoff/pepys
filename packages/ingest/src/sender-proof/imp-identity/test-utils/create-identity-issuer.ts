import type { IdentityTrustDocument } from '@impz/client/identity';

interface IdentityClaims {
  audience: string;
  subject: string;
  name: string;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
}

// The tokens a refusal test picks from: a good one, and one that differs from it in one part each.
export interface SignedTokens {
  good: string;
  otherIssuer: string;
  otherAudience: string;
  forged: string;
}

export interface IdentityIssuer {
  document: IdentityTrustDocument;
  signToken: (claims: IdentityClaims) => Promise<string>;
}

// An issuer of identity tokens for tests: a fresh P-256 key pair, its trust document, and a signer
// of compact ES256 tokens in the shape that `verifyImpIdentity` checks. Every issuer signs with the
// key ID `key-1`, so a token of one issuer carries a key ID that another issuer's document holds.
export async function createIdentityIssuer(issuer: string): Promise<IdentityIssuer> {
  const kid = 'key-1';

  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);

  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);

  return {
    document: {
      issuer,
      keys: [
        {
          kty: 'EC',
          crv: 'P-256',
          x: jwk.x ?? '',
          y: jwk.y ?? '',
          kid,
          alg: 'ES256',
          use: 'sig',
        },
      ],
      retire: [],
    },
    signToken: async (claims) => {
      const header = encodeJSON({ alg: 'ES256', kid });

      const body = encodeJSON({
        iss: issuer,
        sub: claims.subject,
        aud: claims.audience,
        iat: claims.issuedAtSeconds,
        exp: claims.expiresAtSeconds,
        imp_name: claims.name,
      });

      const signature = await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        new TextEncoder().encode(`${header}.${body}`),
      );

      return `${header}.${body}.${Buffer.from(signature).toString('base64url')}`;
    },
  };
}

function encodeJSON(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
