import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openMCPAuthAdmin } from '@zgeoff/mcp-auth';
import type { MCPAuthAdmin } from '@zgeoff/mcp-auth';
import { AUTH_TABLES } from '../auth-tables.ts';
import { GRANT_SCOPES } from '../constants.ts';
import { openMCPAuthDatabase } from '../database/open-mcp-auth-database.ts';
import { systemClock } from '../system-clock.ts';

interface AuthAdmin {
  readonly admin: MCPAuthAdmin;
  readonly close: () => Promise<void>;
}

// The admin calls on the OAuth server's database, for one admin command. A
// running server may hold the same file open.
export async function openAuthAdmin(dbPath: string): Promise<AuthAdmin> {
  mkdirSync(dirname(dbPath), { recursive: true });

  const sqlite = openMCPAuthDatabase(dbPath, systemClock.now());

  try {
    const admin = await openMCPAuthAdmin({
      database: sqlite,
      scopes: GRANT_SCOPES,
      tables: AUTH_TABLES,
      clock: systemClock,

      // A revoke reaches a running server's next verify of the grant's token.
      onGrantRevoked: () => {},
    });

    return {
      admin,
      close: async () => {
        await admin.close();

        sqlite.close();
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
