import type { Kysely } from 'kysely';
import type { MCPAuthSchema } from './mcp-auth-schema.ts';
import type { OAuthGrantID } from './types.ts';

// The tombstone outlives the delete, so a refresh that commits a token of the
// grant after this transaction is refused by the database's insert triggers.
export function revokeGrant(db: Kysely<MCPAuthSchema>, grantID: OAuthGrantID): Promise<boolean> {
  return db.transaction().execute(async (trx) => {
    // A write first takes SQLite's write lock at once; a read first would
    // start a snapshot that a refresh in another process can make stale.
    await trx
      .insertInto('pepys_revoked_grant')
      .columns(['grant_id'])
      .expression(
        trx
          .selectFrom('oauthRefreshToken')
          .select((eb) => eb.val(grantID).as('grant_id'))
          .where('authorizationCodeId', '=', grantID)
          .limit(1),
      )
      .onConflict((conflict) => conflict.doNothing())
      .execute();

    const grant = await trx
      .selectFrom('oauthRefreshToken')
      .select('clientId')
      .where('authorizationCodeId', '=', grantID)
      .executeTakeFirst();

    if (grant === undefined) {
      return false;
    }

    await trx.deleteFrom('oauthAccessToken').where('authorizationCodeId', '=', grantID).execute();
    await trx.deleteFrom('oauthRefreshToken').where('authorizationCodeId', '=', grantID).execute();
    await trx.deleteFrom('oauthConsent').where('clientId', '=', grant.clientId).execute();
    await trx.deleteFrom('pepys_grant_use').where('grant_id', '=', grantID).execute();

    return true;
  });
}
