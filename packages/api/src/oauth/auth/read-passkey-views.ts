import type { Kysely } from 'kysely';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';
import type { PasskeyID } from './types.ts';

export interface PasskeyView {
  readonly id: PasskeyID;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
}

export async function readPasskeyViews(db: Kysely<MCPAuthSchema>): Promise<readonly PasskeyView[]> {
  const rows = await db
    .selectFrom('pepys_passkey')
    .select(['id', 'created_at', 'last_used_at'])
    .orderBy('created_at')
    .orderBy('id')
    .execute();

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  }));
}
