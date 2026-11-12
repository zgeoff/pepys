import invariant from 'tiny-invariant';
import type { MCPAuthSeedDeps } from './types.ts';

export interface DPoPBindingInput {
  readonly clientID: string;

  // The thumbprint of the DPoP key the tokens are bound to.
  readonly jkt: string;
}

export async function seedDPoPBinding(
  deps: Pick<MCPAuthSeedDeps, 'db'>,
  input: DPoPBindingInput,
): Promise<DPoPBindingInput> {
  // A DPoP-bound access token, as better-auth stores one: the token endpoint
  // refuses every DPoP proof, so no code here can issue one.
  const updated = await deps.db
    .updateTable('oauthAccessToken')
    .set({ confirmation: JSON.stringify({ jkt: input.jkt }) })
    .where('clientId', '=', input.clientID)
    .executeTakeFirst();

  invariant(updated.numUpdatedRows > 0n);

  return input;
}
