import type { Database } from '@tursodatabase/database';
import type { DatabaseConnection, Driver } from 'kysely';
import invariant from 'tiny-invariant';
import { createTursoConnection } from './create-turso-connection.ts';

export function createTursoDriver(openDatabase: () => Promise<Database>): Driver {
  let database: Database | undefined;
  let connection: DatabaseConnection | undefined;
  let queue: Promise<void> = Promise.resolve();
  let releaseCurrent: (() => void) | undefined;

  const getDatabase = (): Database => {
    invariant(database, 'Kysely initialises the Turso driver before it uses it');

    return database;
  };

  return {
    init: async () => {
      database = await openDatabase();

      connection = createTursoConnection(database);
    },

    // one connection serves every query, so a transaction holds it until it ends
    acquireConnection: async () => {
      invariant(connection, 'Kysely initialises the Turso driver before it acquires a connection');

      const acquired = connection;
      const previous = queue;
      const turn = Promise.withResolvers<void>();

      queue = turn.promise;

      await previous;

      releaseCurrent = turn.resolve;

      return acquired;
    },
    beginTransaction: async () => {
      await getDatabase().exec('begin');
    },
    commitTransaction: async () => {
      await getDatabase().exec('commit');
    },
    rollbackTransaction: async () => {
      await getDatabase().exec('rollback');
    },
    releaseConnection: () => {
      invariant(releaseCurrent, 'Kysely releases only a connection it acquired');
      releaseCurrent();

      return Promise.resolve();
    },

    // a connection in use finishes before the database closes
    destroy: async () => {
      await queue;
      await getDatabase().close();
    },
  };
}
