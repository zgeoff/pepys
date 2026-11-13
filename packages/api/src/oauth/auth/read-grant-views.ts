import { toTagged } from '@zgeoff/std';
import type { Kysely } from 'kysely';
import { GRANT_SCOPES } from '../constants.ts';
import type { GrantScope } from '../constants.ts';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';
import { parseJSONStrings } from './parse-json-strings.ts';
import type { OAuthClientID, OAuthGrantID } from './types.ts';

export interface GrantView {
  readonly grantID: OAuthGrantID;
  readonly clientID: OAuthClientID;
  readonly clientName: string;
  readonly scopes: readonly GrantScope[];
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export async function readGrantViews(db: Kysely<MCPAuthSchema>): Promise<readonly GrantView[]> {
  const rows = await db
    .selectFrom('oauthRefreshToken')
    .leftJoin('oauthClient', 'oauthClient.clientId', 'oauthRefreshToken.clientId')
    .leftJoin(
      'pepys_grant_use',
      'pepys_grant_use.grant_id',
      'oauthRefreshToken.authorizationCodeId',
    )
    .select([
      'oauthRefreshToken.authorizationCodeId',
      'oauthRefreshToken.clientId',
      'oauthRefreshToken.scopes',
      'oauthRefreshToken.createdAt',
      'oauthClient.name',
      'pepys_grant_use.last_used_at',
    ])
    .where('oauthRefreshToken.revoked', 'is', null)
    .where('oauthRefreshToken.expiresAt', '>', new Date().toISOString())
    .where('oauthRefreshToken.authorizationCodeId', 'is not', null)
    .orderBy('oauthRefreshToken.createdAt')
    .execute();

  return rows.flatMap((row) => {
    if (row.authorizationCodeId === null) {
      return [];
    }

    const scopes = parseJSONStrings(row.scopes) ?? [];

    return {
      grantID: toTagged<OAuthGrantID>(row.authorizationCodeId),
      clientID: toTagged<OAuthClientID>(row.clientId),
      clientName: row.name ?? '',
      scopes: GRANT_SCOPES.filter((scope) => scopes.includes(scope)),
      createdAt: row.createdAt,
      lastUsedAt: row.last_used_at,
    };
  });
}
