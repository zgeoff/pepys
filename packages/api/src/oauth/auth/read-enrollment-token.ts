import type { Kysely } from 'kysely';
import { deriveTokenHash } from './derive-token-hash.ts';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';

export async function readEnrollmentToken(
  db: Kysely<MCPAuthSchema>,
  token: string,
  now: number,
): Promise<string | null> {
  const row = await db
    .selectFrom('pepys_enrollment_token')
    .select('token_hash')
    .where('token_hash', '=', deriveTokenHash(token))
    .where('expires_at', '>', new Date(now).toISOString())
    .executeTakeFirst();

  return row?.token_hash ?? null;
}
