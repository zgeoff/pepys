import type { Kysely } from 'kysely';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';
import type { OAuthClientID, OAuthGrantID } from './types.ts';

interface TokenView {
  readonly clientID: OAuthClientID;
  readonly grantID: OAuthGrantID | null;
}

export interface TokenViews {
  readonly accessTokens: readonly TokenView[];
  readonly refreshTokens: readonly TokenView[];
}

// Every stored token, revoked and expired ones too.
export async function readTokenViews(db: Kysely<MCPAuthSchema>): Promise<TokenViews> {
  const accessTokens = await db
    .selectFrom('oauthAccessToken')
    .select(['clientId', 'authorizationCodeId'])
    .orderBy('clientId')
    .orderBy('id')
    .execute();

  const refreshTokens = await db
    .selectFrom('oauthRefreshToken')
    .select(['clientId', 'authorizationCodeId'])
    .orderBy('clientId')
    .orderBy('id')
    .execute();

  return {
    accessTokens: accessTokens.map((row) => toTokenView(row)),
    refreshTokens: refreshTokens.map((row) => toTokenView(row)),
  };
}

interface TokenRow {
  readonly clientId: OAuthClientID;
  readonly authorizationCodeId: OAuthGrantID | null;
}

function toTokenView(row: TokenRow): TokenView {
  return { clientID: row.clientId, grantID: row.authorizationCodeId };
}
