import { Database } from 'bun:sqlite';
import { randomBytes } from 'node:crypto';
import type { OAuthClientID } from '@zgeoff/mcp-auth';
import { toTagged } from '@zgeoff/std';
import { openAuthAdmin } from '../admin/open-auth-admin.ts';

// A client row that an app from before the auth core cleaned names wrote: its
// name is stored as given, so it can clean to the name of another client.
// Written directly, since the core now cleans each name it stores.
export async function seedLegacyClient(dbPath: string, name: string): Promise<OAuthClientID> {
  const opened = await openAuthAdmin(dbPath);

  await opened.close();

  const clientID = toTagged<OAuthClientID>(`legacy${randomBytes(16).toString('hex')}`);

  const at = new Date(0).toISOString();
  const sqlite = new Database(dbPath);

  sqlite.run(
    `insert into "oauthClient" (id, "clientId", disabled, scopes, "clientCredentialsScopes", "createdAt", "updatedAt", name, "redirectUris", "tokenEndpointAuthMethod", "applicationType", "grantTypes", "responseTypes", "requirePKCE") values (?, ?, 0, ?, '[]', ?, ?, ?, ?, 'none', 'web', ?, ?, 1)`,
    [
      `record-${clientID}`,
      clientID,
      JSON.stringify(['read', 'offline_access']),
      at,
      at,
      name,
      JSON.stringify(['https://assistant.example.com/callback']),
      JSON.stringify(['authorization_code', 'refresh_token']),
      JSON.stringify(['code']),
    ],
  );

  sqlite.close();

  return clientID;
}
