import { randomBytes } from 'node:crypto';
import type { NewPasskey } from '../auth/create-passkey.ts';

export function buildMockNewPasskey(overrides: Partial<NewPasskey> = {}): NewPasskey {
  return {
    tokenHash: randomBytes(32).toString('hex'),
    id: randomBytes(16).toString('base64url'),
    publicKey: 'AQID',
    counter: 0,
    transports: ['internal'],
    now: Date.parse('2026-11-01T08:00:00.000Z'),
    ...overrides,
  };
}
