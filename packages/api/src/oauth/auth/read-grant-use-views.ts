import { toTagged } from '@zgeoff/std';
import type { Kysely } from 'kysely';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';
import type { OAuthGrantID } from './types.ts';

export interface GrantUseView {
  readonly grantID: OAuthGrantID;
  readonly lastUsedAt: string;
}

// Every recorded grant use, also one whose grant has no tokens left.
export async function readGrantUseViews(
  db: Kysely<MCPAuthSchema>,
): Promise<readonly GrantUseView[]> {
  const rows = await db
    .selectFrom('pepys_grant_use')
    .select(['grant_id', 'last_used_at'])
    .orderBy('grant_id')
    .execute();

  return rows.map((row) => ({
    grantID: toTagged<OAuthGrantID>(row.grant_id),
    lastUsedAt: row.last_used_at,
  }));
}
