import type { Kysely } from 'kysely';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';
import type { OwnerSessionID } from './types.ts';

export interface OwnerSessionView {
  readonly id: OwnerSessionID;
  readonly expiresAt: string;
}

export async function readOwnerSessionViews(
  db: Kysely<MCPAuthSchema>,
): Promise<readonly OwnerSessionView[]> {
  const rows = await db.selectFrom('session').select(['id', 'expiresAt']).execute();

  return rows;
}
