import type { ConsumerDeclaration } from '@pepys/kit';
import { createTursoDialect } from '@pepys/kysely-turso';
import { connect } from '@tursodatabase/database';
import type { Database } from '@tursodatabase/database';
import { Kysely } from 'kysely';
import { formatStoreSchema } from './format-store-schema.ts';
import type { StoreDatabase, StoreTables } from './types.ts';

interface StoreConnection {
  db: StoreDatabase;

  // The same database under the table types of one query. Kysely cannot narrow its own table
  // types to a generic set of consumers, so a query call gets its own instance.
  database: Database;
}

// One in-memory database with every table of `consumers`, the link and scope tables, and the two
// shared views.
export async function createStoreDatabase(
  consumers: readonly ConsumerDeclaration[],
): Promise<StoreConnection> {
  const database = await connect(':memory:');

  await database.exec(formatStoreSchema(consumers));

  const db = new Kysely<StoreTables>({
    dialect: createTursoDialect({ database: () => Promise.resolve(database) }),
  });

  return { db, database };
}
