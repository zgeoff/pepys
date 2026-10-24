import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createTursoDialect } from '@pepys/kysely-turso';
import { connect } from '@tursodatabase/database';
import { Kysely } from 'kysely';
import type { ConsumerDB, StoreReader } from './types.ts';

interface OpenConsumer {
  target: string;
  database: Kysely<ConsumerDB>;
}

export function createStoreReader(storeDirectory: string): StoreReader {
  const open = new Map<string, OpenConsumer>();

  const readConsumer = async (consumerName: string): Promise<Kysely<ConsumerDB>> => {
    // the link swings to a new version directory when `pepys up` swaps, and the old file stays
    const target = await realpath(join(storeDirectory, consumerName, 'current'));

    const existing = open.get(consumerName);

    if (existing?.target === target) {
      return existing.database;
    }

    const database = new Kysely<ConsumerDB>({
      dialect: createTursoDialect({
        database: () =>
          connect(join(target, 'consumer.db'), {
            readonly: true,
            experimental: ['multiprocess_wal'],
          }),
      }),
    });

    open.set(consumerName, { target, database });

    await existing?.database.destroy();

    return database;
  };

  const close = async (): Promise<void> => {
    const databases = [...open.values()].map((consumer) => consumer.database);

    open.clear();

    await Promise.all(databases.map((database) => database.destroy()));
  };

  return { readConsumer, close };
}
