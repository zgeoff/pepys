import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { match } from 'ts-pattern';
import type { DeliveryCheck } from '../sources/types.ts';

// The check of one delivery, on the body as sent. Ingest calls it for every receive path, and the
// sender's proof must pass it. An empty secret passes nothing, so a missing variable never opens a
// route.
export function isDeliveryAuthentic(
  check: DeliveryCheck,
  secret: string,
  headers: Headers,
  body: Uint8Array,
): boolean {
  const proof = headers.get(check.header);

  if (secret === '' || proof === null) {
    return false;
  }

  return match(check.kind)
    .with('hmac-sha256', () => isSignatureAuthentic(secret, proof, body))
    .with('token', () => isTokenAuthentic(secret, proof))
    .exhaustive();
}

const signaturePattern = /^sha256=(?<hex>[0-9a-fA-F]{64})$/u;

function isSignatureAuthentic(secret: string, signature: string, body: Uint8Array): boolean {
  const hex = signaturePattern.exec(signature)?.groups?.['hex'];

  if (hex === undefined) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(body).digest();

  return timingSafeEqual(Buffer.from(hex, 'hex'), expected);
}

const bearerPrefix = 'Bearer ';

// Both sides are hashed first, so the compare takes the same time for a token of any length.
function isTokenAuthentic(secret: string, proof: string): boolean {
  const token = proof.startsWith(bearerPrefix) ? proof.slice(bearerPrefix.length) : proof;
  const tokenDigest = createHash('sha256').update(token).digest();
  const secretDigest = createHash('sha256').update(secret).digest();

  return timingSafeEqual(tokenDigest, secretDigest);
}
