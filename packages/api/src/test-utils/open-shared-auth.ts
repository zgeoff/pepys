import { DEFAULT_PATHS, openMCPAuth } from '@zgeoff/mcp-auth';
import type { MCPAuth } from '@zgeoff/mcp-auth';
import { AUTH_TABLES } from '../oauth/auth-tables.ts';
import { GRANT_SCOPES } from '../oauth/constants.ts';
import type { GrantScope } from '../oauth/constants.ts';
import { openMCPAuthDatabase } from '../oauth/database/open-mcp-auth-database.ts';
import { registerTestCleanup } from '../oauth/test-utils/register-test-cleanup.ts';

interface SharedAuthTarget {
  // The public origin the server serves, or would serve, and its database file.
  readonly origin: string;
  readonly dbPath: string;
}

// A second auth core on a server's database file, for a test to sign in and
// seed passkeys through. The server reads what it writes to the shared file.
export async function openSharedAuth(target: SharedAuthTarget): Promise<MCPAuth<GrantScope, null>> {
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
  });

  registerTestCleanup(() => auth.close());

  return auth;
}
