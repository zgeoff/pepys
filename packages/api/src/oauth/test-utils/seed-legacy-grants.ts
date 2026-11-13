import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { GrantID, OAuthClientID, PasskeyID } from '@zgeoff/mcp-auth';
import { toTagged } from '@zgeoff/std';

interface LegacyGrantInput {
  readonly clientName: string;

  // How many times the client refreshed the grant before the migration.
  readonly refreshes: number;
}

interface LegacyGrant {
  readonly grantID: GrantID;
  readonly clientID: OAuthClientID;

  // The grant's newest tokens, in plain text.
  readonly accessToken: string;
  readonly refreshToken: string;
}

interface LegacyAuthState {
  readonly grants: readonly LegacyGrant[];

  // A grant the grants command revoked, whose tombstone the file still holds.
  readonly revokedGrantID: GrantID;
  readonly passkeyID: PasskeyID;
}

const OWNER_ID = 'owner-row-0000000000000000000000';

// The OAuth server's file as pepys 0.4.0 left it: one owner user row under
// every token, each token carrying its grant's authorization code ID. Written
// directly, since the server that wrote it is gone.
export function seedLegacyGrants(
  path: string,
  grants: readonly LegacyGrantInput[],
  now: number,
): LegacyAuthState {
  const sqlite = new Database(path, { create: true });

  for (const statement of readLegacySchema()) {
    sqlite.run(statement);
  }

  const at = new Date(now).toISOString();

  const resources = JSON.stringify(['http://127.0.0.1:8081/mcp']);
  const scopes = JSON.stringify(['read', 'offline_access']);

  sqlite.run(
    `insert into "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt") values (?, 'owner', 'owner@pepys.invalid', 1, null, ?, ?)`,
    [OWNER_ID, at, at],
  );

  sqlite.run(
    `insert into session (id, "expiresAt", token, "createdAt", "updatedAt", "ipAddress", "userAgent", "userId") values ('owner-session', ?, 'owner-session-token', ?, ?, null, null, ?)`,
    [new Date(now + 30 * 60_000).toISOString(), at, at, OWNER_ID],
  );

  const seeded = grants.map((grant, index) => {
    const grantID = `code-${index}-${randomText()}`;
    const clientID = `client-${index}-${randomText()}`;

    sqlite.run(
      `insert into "oauthClient" (id, "clientId", disabled, scopes, "clientCredentialsScopes", "userId", "createdAt", "updatedAt", name, "redirectUris", "tokenEndpointAuthMethod", "applicationType", "grantTypes", "responseTypes", "requirePKCE", "dpopBoundAccessTokens") values (?, ?, 0, ?, '[]', null, ?, ?, ?, ?, 'none', 'web', ?, ?, 1, 0)`,
      [
        `record-${clientID}`,
        clientID,
        scopes,
        at,
        at,
        grant.clientName,
        JSON.stringify(['https://assistant.example.com/callback']),
        JSON.stringify(['authorization_code', 'refresh_token']),
        JSON.stringify(['code']),
      ],
    );

    sqlite.run(
      `insert into "oauthConsent" (id, "clientId", "userId", resources, "requestedUserInfoClaims", scopes, "createdAt", "updatedAt") values (?, ?, ?, ?, '[]', ?, ?, ?)`,
      [`consent-${clientID}`, clientID, OWNER_ID, resources, scopes, at, at],
    );

    let tokens = { accessToken: '', refreshToken: '' };

    for (let issue = 0; issue <= grant.refreshes; issue++) {
      const isNewest = issue === grant.refreshes;
      const refreshID = `refresh-${index}-${issue}`;

      tokens = { accessToken: randomText(), refreshToken: randomText() };

      sqlite.run(
        `insert into "oauthRefreshToken" (id, token, "clientId", "sessionId", "userId", "authorizationCodeId", resources, "expiresAt", "createdAt", revoked, "rotatedAt", "authTime", scopes) values (?, ?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          refreshID,
          hashToken(tokens.refreshToken),
          clientID,
          OWNER_ID,
          grantID,
          resources,
          new Date(now + 30 * 24 * 60 * 60_000).toISOString(),
          at,
          isNewest ? null : at,
          isNewest ? null : at,
          at,
          scopes,
        ],
      );

      sqlite.run(
        `insert into "oauthAccessToken" (id, token, "clientId", "sessionId", "userId", "authorizationCodeId", resources, "refreshId", "expiresAt", "createdAt", revoked, scopes) values (?, ?, ?, null, ?, ?, ?, ?, ?, ?, null, ?)`,
        [
          `access-${index}-${issue}`,
          hashToken(tokens.accessToken),
          clientID,
          OWNER_ID,
          grantID,
          resources,
          refreshID,
          new Date(now + 60 * 60_000).toISOString(),
          at,
          scopes,
        ],
      );
    }

    sqlite.run('insert into pepys_grant_use (grant_id, last_used_at) values (?, ?)', [grantID, at]);

    return {
      grantID: toTagged<GrantID>(grantID),
      clientID: toTagged<OAuthClientID>(clientID),
      ...tokens,
    };
  });

  const revokedGrantID = `code-revoked-${randomText()}`;
  const passkeyID = `passkey-${randomText()}`;

  sqlite.run('insert into pepys_revoked_grant (grant_id) values (?)', [revokedGrantID]);

  sqlite.run(
    `insert into pepys_passkey (id, public_key, counter, transports, created_at, last_used_at) values (?, 'cHVibGljLWtleQ', 3, '["internal"]', ?, null)`,
    [passkeyID, at],
  );

  sqlite.close();

  return {
    grants: seeded,
    revokedGrantID: toTagged<GrantID>(revokedGrantID),
    passkeyID: toTagged<PasskeyID>(passkeyID),
  };
}

const LEGACY_SCHEMA_URL = new URL('legacy-auth-schema.sql', import.meta.url);

function readLegacySchema(): string[] {
  return readFileSync(LEGACY_SCHEMA_URL, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('--'));
}

function randomText(): string {
  return randomBytes(24).toString('base64url');
}

// pepys stored each token as the SHA-256 of its text, in base64url.
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}
