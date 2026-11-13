import type { Kysely } from 'kysely';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';

// every stored token, an expired one too: a token that was only expired, never deleted, still shows
export async function readEnrollmentTokenHashes(
  db: Kysely<MCPAuthSchema>,
): Promise<readonly string[]> {
  const rows = await db
    .selectFrom('pepys_enrollment_token')
    .select('token_hash')
    .orderBy('token_hash')
    .execute();

  return rows.map((row) => row.token_hash);
}
