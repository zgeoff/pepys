import type { Kysely } from 'kysely';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';

export async function resetPasskeys(db: Kysely<MCPAuthSchema>): Promise<void> {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('pepys_passkey').execute();
    await trx.deleteFrom('pepys_enrollment_token').execute();
    await trx.deleteFrom('session').execute();
  });
}
