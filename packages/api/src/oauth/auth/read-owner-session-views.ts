import type { Kysely } from 'kysely';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';

export interface OwnerSessionView {
  readonly id: string;
  readonly expiresAt: string;
}

export function readOwnerSessionViews(
  db: Kysely<MCPAuthSchema>,
): Promise<readonly OwnerSessionView[]> {
  return db.selectFrom('session').select(['id', 'expiresAt']).execute();
}
