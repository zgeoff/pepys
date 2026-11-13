import { isRecord, toTagged } from '@zgeoff/std';
import { isAPIError } from 'better-auth/api';
import type { HTTPServerContext, OAuthClientID } from '../auth/types.ts';
import { GRANT_SCOPES } from '../constants.ts';
import type { GrantScope } from '../constants.ts';

interface TokenAccess {
  readonly clientID: OAuthClientID;
  readonly scopes: readonly GrantScope[];
}

// An inactive, unknown, expired or revoked token, one bound to another
// resource or to a key, or one without a client id reads as null. Reading records no use.
export async function readTokenAccess(
  ctx: HTTPServerContext,
  token: string,
): Promise<TokenAccess | null> {
  let payload: unknown;

  try {
    payload = await ctx.store.auth.api.verifyMCPAccessToken({ body: { token } });
  } catch (error) {
    if (isAPIError(error)) {
      return null;
    }

    throw error;
  }

  if (!isRecord(payload) || ![payload['aud']].flat().includes(ctx.resource)) {
    return null;
  }

  // A token bound to a key, such as a DPoP key, needs a proof of that key,
  // and /mcp takes a bearer token alone.
  if (payload['token_type'] !== 'Bearer' || payload['cnf'] !== undefined) {
    return null;
  }

  const granted = typeof payload['scope'] === 'string' ? payload['scope'].split(' ') : [];
  const clientID = typeof payload['client_id'] === 'string' ? payload['client_id'] : '';

  if (clientID === '') {
    return null;
  }

  return {
    clientID: toTagged<OAuthClientID>(clientID),
    scopes: GRANT_SCOPES.filter((scope) => granted.includes(scope)),
  };
}
