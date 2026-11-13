import { Database } from 'bun:sqlite';
import { buildSQLiteDialect } from '@zgeoff/kysely-bun-sqlite';
import type { MCPAuthDatabase } from '../auth/mcp-auth-database.ts';

export function openMCPAuthDatabase(path: string): MCPAuthDatabase {
  const sqlite = new Database(path, { create: true });

  // The admin commands and a running server share the file, so a write waits
  // for the other's lock. A client's cascades to its tokens need foreign keys.
  sqlite.run('PRAGMA journal_mode = WAL;');
  sqlite.run('PRAGMA busy_timeout = 5000;');
  sqlite.run('PRAGMA foreign_keys = ON;');

  return {
    dialect: buildSQLiteDialect(sqlite),
    close: () => {
      sqlite.close();
    },
  };
}
