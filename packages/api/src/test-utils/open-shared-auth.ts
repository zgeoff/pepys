import { DEFAULT_PATHS, openMCPAuth } from '@zgeoff/mcp-auth';
import type { MCPAuth, MCPAuthOptions } from '@zgeoff/mcp-auth';
import { registerTestCleanup } from '@zgeoff/testing';
import { AUTH_TABLES } from '../oauth/auth-tables.ts';
import { GRANT_SCOPES } from '../oauth/constants.ts';
import type { GrantScope } from '../oauth/constants.ts';
import { openMCPAuthDatabase } from '../oauth/database/open-mcp-auth-database.ts';

interface SharedAuthTarget {
  // The public origin the server serves, or would serve, and its database file.
  readonly origin: string;
  readonly dbPath: string;

  // The service clients the core starts with; absent opens it with none.
  readonly serviceTokens?: MCPAuthOptions<GrantScope, null>['serviceTokens'];
}

// A second auth core on a server's database file, for a test to sign in and
// seed passkeys through. The server reads what it writes to the shared file.
export async function openSharedAuth(target: SharedAuthTarget): Promise<MCPAuth<GrantScope>> {
  const sqlite = openMCPAuthDatabase(target.dbPath, Date.now());

  registerTestCleanup(() => {
    sqlite.close();
  });

  const auth = await openMCPAuth({
    database: sqlite,
    origin: target.origin,
    productName: 'pepys',
    scopes: GRANT_SCOPES,
    paths: DEFAULT_PATHS,
    tables: AUTH_TABLES,
    clock: { now: () => Date.now() },
    security: { record: () => {} },
    onGrantRevoked: () => {},
    ...(target.serviceTokens === undefined ? {} : { serviceTokens: target.serviceTokens }),
  });

  registerTestCleanup(() => auth.close());

  return auth;
}
