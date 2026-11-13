import type { Database } from 'bun:sqlite';
import { z } from 'zod';
import { runGrantRowMigration } from './run-grant-row-migration.ts';

// Each migration, in order; the database's user_version counts the ones it ran.
const MIGRATIONS: readonly ((sqlite: Database, now: number) => void)[] = [runGrantRowMigration];

// Runs each migration the file has yet to run, each in its own transaction.
// Foreign keys are off while one runs, since a rebuilt table is dropped and
// renamed, and a pragma inside a transaction does nothing.
export function runAuthMigrations(sqlite: Database, now: number): void {
  sqlite.run('PRAGMA foreign_keys = OFF;');

  for (const [index, migration] of MIGRATIONS.entries()) {
    const version = index + 1;

    // Immediate takes the write lock first, so an admin command and a server
    // that open the file at once never both run a migration.
    sqlite
      .transaction(() => {
        if (readUserVersion(sqlite) >= version) {
          return;
        }

        migration(sqlite, now);

        sqlite.run(`PRAGMA user_version = ${version};`);
      })
      .immediate();
  }
}

const VersionRowSchema = z.object({ user_version: z.number() });

function readUserVersion(sqlite: Database): number {
  return VersionRowSchema.parse(sqlite.query('PRAGMA user_version').get()).user_version;
}
