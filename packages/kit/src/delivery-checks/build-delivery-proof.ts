import { createHmac } from 'node:crypto';
import { match } from 'ts-pattern';
import type { DeliveryCheck } from '../sources/types.ts';

// The value of the check's header for one body: `sha256=<hex>` of the HMAC for a signed path, and
// `Bearer <secret>` for a token path.
export function buildDeliveryProof(check: DeliveryCheck, secret: string, body: Uint8Array): string {
  return match(check.kind)
    .with('hmac-sha256', () => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`)
    .with('token', () => `Bearer ${secret}`)
    .exhaustive();
}
