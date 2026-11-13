import { Database } from 'bun:sqlite';
import { chmodSync, closeSync, openSync } from 'node:fs';
import { runAuthMigrations } from './run-auth-migrations.ts';

// The OAuth server's database file, migrated to the shape the auth core reads.
// `now` decides which tokens a migration counts as live.
export function openMCPAuthDatabase(path: string, now: number): Database {
  // The file holds token hashes and sessions, so only its owner may read it.
  // SQLite gives the WAL and shared-memory files the main file's mode, so the
  // mode is set before SQLite opens it.
  closeSync(openSync(path, 'a', 0o600));
  chmodSync(path, 0o600);

  const sqlite = new Database(path, { create: true });

  // The admin commands and a running server share the file, so a write waits
  // for the other's lock.
  sqlite.run('PRAGMA journal_mode = WAL;');
  sqlite.run('PRAGMA busy_timeout = 5000;');

  try {
    runAuthMigrations(sqlite, now);
  } catch (error) {
    sqlite.close();
    throw error;
  }

  // A revoke is one delete that cascades to the grant's tokens.
  sqlite.run('PRAGMA foreign_keys = ON;');

  return sqlite;
}
