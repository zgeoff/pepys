import type { Kysely } from 'kysely';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';
import type { OwnerSessionID } from './types.ts';

export async function removeOwnerSession(
  db: Kysely<MCPAuthSchema>,
  sessionID: OwnerSessionID,
): Promise<void> {
  await db.deleteFrom('session').where('id', '=', sessionID).execute();
}
