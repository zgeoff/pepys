import { toTagged } from '@zgeoff/std';
import type { Kysely } from 'kysely';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';
import type { OAuthClientID } from './types.ts';

export interface ConsentView {
  readonly clientID: OAuthClientID;
}

export async function readConsentViews(db: Kysely<MCPAuthSchema>): Promise<readonly ConsentView[]> {
  const rows = await db
    .selectFrom('oauthConsent')
    .select('clientId')
    .orderBy('clientId')
    .orderBy('id')
    .execute();

  return rows.map((row) => ({ clientID: toTagged<OAuthClientID>(row.clientId) }));
}
