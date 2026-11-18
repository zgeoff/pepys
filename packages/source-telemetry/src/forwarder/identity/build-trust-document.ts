import { buildKeyID } from './build-key-id.ts';
import type { Identity } from './types.ts';

// The trust document of a machine, in the format that `loadIdentityIssuers` reads.
export function buildTrustDocument(identity: Pick<Identity, 'issuer' | 'publicKey'>) {
  return {
    issuer: identity.issuer,
    keys: [
      {
        kty: identity.publicKey.kty,
        crv: identity.publicKey.crv,
        x: identity.publicKey.x,
        y: identity.publicKey.y,
        kid: buildKeyID(identity.publicKey),
        alg: 'ES256',
        use: 'sig',
      },
    ],
    retire: [],
  };
}
