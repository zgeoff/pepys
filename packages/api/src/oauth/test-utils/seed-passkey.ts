import invariant from 'tiny-invariant';
import { createEnrollmentToken } from '../auth/create-enrollment-token.ts';
import { createPasskey } from '../auth/create-passkey.ts';
import type { NewPasskey } from '../auth/create-passkey.ts';
import { deriveTokenHash } from '../auth/derive-token-hash.ts';
import { buildMockNewPasskey } from './build-mock-new-passkey.ts';
import type { MCPAuthSeedDeps } from './types.ts';

export type PasskeyInput = Partial<Omit<NewPasskey, 'tokenHash'>>;

export async function seedPasskey(
  deps: MCPAuthSeedDeps,
  input: PasskeyInput = {},
): Promise<NewPasskey> {
  const now = input.now ?? deps.clock.now();

  const enrollment = await createEnrollmentToken(deps.db, now);

  const passkey = buildMockNewPasskey({
    ...input,
    now,
    tokenHash: deriveTokenHash(enrollment.token),
  });

  const created = await createPasskey(deps.db, passkey);

  invariant(created);

  return passkey;
}
