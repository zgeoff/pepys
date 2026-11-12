import type { Kysely } from 'kysely';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';

export async function writeGrantUse(
  db: Kysely<MCPAuthSchema>,
  grantID: string,
  now: number,
): Promise<void> {
  const lastUsedAt = new Date(now).toISOString();

  await db
    .insertInto('pepys_grant_use')
    .values({ grant_id: grantID, last_used_at: lastUsedAt })
    .onConflict((conflict) => conflict.column('grant_id').doUpdateSet({ last_used_at: lastUsedAt }))
    .execute();
}
