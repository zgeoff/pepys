import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { createTursoDialect } from '@pepys/kysely-turso';
import type { Result } from '@pepys/schema';
import type { Database } from '@tursodatabase/database';
import { Kysely } from 'kysely';
import type { Transaction } from 'kysely';
import type { ConsumerDB, StoreReader } from './types.ts';

interface OpenConsumer {
  target: string;
  database: Kysely<ConsumerDB>;
  readers: number;
  isRetired: boolean;
}

interface StoreReaderOptions {
  storeDirectory: string;
  openDatabase: (path: string) => Promise<Database>;
}

export function createStoreReader(options: StoreReaderOptions): StoreReader {
  const open = new Map<string, OpenConsumer>();
  const retired = new Set<OpenConsumer>();

  const withConsumer = async <Value>(
    consumerName: string,
    work: (transaction: Transaction<ConsumerDB>) => Promise<Value>,
  ): Promise<Result<Value, { reason: 'no-current-version' }>> => {
    // the link swings to a new version directory when `pepys up` swaps, and the old file stays
    const target = await readCurrentTarget(join(options.storeDirectory, consumerName, 'current'));

    if (target === null) {
      return { ok: false, failure: { reason: 'no-current-version' } };
    }

    const opened = openConsumer(consumerName, target);
    const consumer = opened.consumer;

    consumer.readers += 1;

    if (opened.replaced !== undefined) {
      await destroyIfDrained(opened.replaced);
    }

    try {
      // one transaction keeps every read of a call on one connection and one snapshot
      return { ok: true, value: await consumer.database.transaction().execute(work) };
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
          database: () => options.openDatabase(join(target, 'consumer.db')),
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

async function readCurrentTarget(currentLink: string): Promise<string | null> {
  try {
    return await realpath(currentLink);
  } catch (error: unknown) {
    if (isMissingFileError(error)) {
      return null;
    }

    throw error;
  }
}

function isMissingFileError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
