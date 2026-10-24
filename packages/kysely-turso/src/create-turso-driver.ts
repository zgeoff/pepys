import type { Database } from '@tursodatabase/database';
import type { DatabaseConnection, Driver } from 'kysely';
import { createTursoConnection } from './create-turso-connection.ts';

export function createTursoDriver(openDatabase: () => Promise<Database>): Driver {
  let database: Database | undefined;
  let connection: DatabaseConnection | undefined;
  let queue: Promise<void> = Promise.resolve();
  let releaseCurrent: (() => void) | undefined;

  return {
    init: async () => {
      database = await openDatabase();

      connection = createTursoConnection(database);
    },

    // one connection serves every query, so a transaction holds it until it ends
    acquireConnection: async () => {
      const previous = queue;
      const turn = Promise.withResolvers<void>();

      queue = turn.promise;

      await previous;

      releaseCurrent = turn.resolve;

      if (connection === undefined) {
        throw new Error('the Turso driver was used before init');
      }

      return connection;
    },
    beginTransaction: async () => {
      await database?.exec('begin');
    },
    commitTransaction: async () => {
      await database?.exec('commit');
    },
    rollbackTransaction: async () => {
      await database?.exec('rollback');
    },
    releaseConnection: () => {
      releaseCurrent?.();

      return Promise.resolve();
    },
    destroy: async () => {
      await database?.close();
    },
  };
}
