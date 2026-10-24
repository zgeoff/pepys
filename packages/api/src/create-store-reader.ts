import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createTursoDialect } from '@pepys/kysely-turso';
import { connect } from '@tursodatabase/database';
import { Kysely } from 'kysely';
import type { Transaction } from 'kysely';
import type { ConsumerDB, StoreReader } from './types.ts';

interface OpenConsumer {
  target: string;
  database: Kysely<ConsumerDB>;
  readers: number;
  isRetired: boolean;
}

export function createStoreReader(storeDirectory: string): StoreReader {
  const open = new Map<string, OpenConsumer>();
  const retired = new Set<OpenConsumer>();

  const withConsumer = async <Result>(
    consumerName: string,
    work: (transaction: Transaction<ConsumerDB>) => Promise<Result>,
  ): Promise<Result> => {
    // the link swings to a new version directory when `pepys up` swaps, and the old file stays
    const target = await realpath(join(storeDirectory, consumerName, 'current'));

    const opened = openConsumer(consumerName, target);
    const consumer = opened.consumer;

    consumer.readers += 1;

    if (opened.replaced !== undefined) {
      await destroyIfDrained(opened.replaced);
    }

    try {
      // one transaction keeps every read of a call on one connection and one snapshot
      return await consumer.database.transaction().execute(work);
    } finally {
      consumer.readers -= 1;

      await destroyIfDrained(consumer);
    }
  };

  const openConsumer = (
    consumerName: string,
    target: string,
  ): { consumer: OpenConsumer; replaced?: OpenConsumer } => {
    const existing = open.get(consumerName);

    if (existing?.target === target) {
      return { consumer: existing };
    }

    const consumer: OpenConsumer = {
      target,
      database: new Kysely<ConsumerDB>({
        dialect: createTursoDialect({
          database: () =>
            connect(join(target, 'consumer.db'), {
              readonly: true,
              experimental: ['multiprocess_wal'],
            }),
        }),
      }),
      readers: 0,
      isRetired: false,
    };

    open.set(consumerName, consumer);

    if (existing === undefined) {
      return { consumer };
    }

    existing.isRetired = true;

    retired.add(existing);

    return { consumer, replaced: existing };
  };

  const destroyIfDrained = async (consumer: OpenConsumer): Promise<void> => {
    if (consumer.isRetired && consumer.readers === 0 && retired.delete(consumer)) {
      await consumer.database.destroy();
    }
  };

  const close = async (): Promise<void> => {
    const consumers = [...open.values(), ...retired];

    open.clear();
    retired.clear();

    // a destroy waits for the reads still running on the database
    await Promise.all(consumers.map((consumer) => consumer.database.destroy()));
  };

  return { withConsumer, close };
}
