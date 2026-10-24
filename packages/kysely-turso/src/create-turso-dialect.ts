import type { Database } from '@tursodatabase/database';
import { SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from 'kysely';
import type { Dialect, Kysely } from 'kysely';
import { createTursoDriver } from './create-turso-driver.ts';

export interface TursoDialectConfig {
  readonly database: () => Promise<Database>;
}

export function createTursoDialect(config: TursoDialectConfig): Dialect {
  return {
    createDriver: () => createTursoDriver(config.database),
    createQueryCompiler: () => new SqliteQueryCompiler(),
    createAdapter: () => new SqliteAdapter(),
    createIntrospector: (db: Kysely<unknown>) => new SqliteIntrospector(db),
  };
}
