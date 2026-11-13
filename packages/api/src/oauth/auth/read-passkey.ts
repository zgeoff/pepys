import type { Kysely } from 'kysely';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';
import type { PasskeyID } from './types.ts';

export interface StoredPasskey {
  readonly id: PasskeyID;

  // The COSE public key, base64url.
  readonly publicKey: string;
  readonly counter: number;

  // A JSON array of transport names.
  readonly transports: string;
  readonly lastUsedAt: string | null;
}

export async function readPasskey(
  db: Kysely<MCPAuthSchema>,
  id: PasskeyID,
): Promise<StoredPasskey | null> {
  const row = await db
    .selectFrom('pepys_passkey')
    .select(['id', 'public_key', 'counter', 'transports', 'last_used_at'])
    .where('id', '=', id)
    .executeTakeFirst();

  if (row === undefined) {
    return null;
  }

  return {
    id: row.id,
    publicKey: row.public_key,
    counter: row.counter,
    transports: row.transports,
    lastUsedAt: row.last_used_at,
  };
}
