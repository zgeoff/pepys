import { createHash } from 'node:crypto';
import type { PublicKeyJWK } from './types.ts';

// The RFC 7638 SHA-256 thumbprint of an EC key: the required members in lexicographic order, with
// no white space.
export function buildKeyID(key: PublicKeyJWK): string {
  const members = JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y });

  return createHash('sha256').update(members).digest('base64url');
}
