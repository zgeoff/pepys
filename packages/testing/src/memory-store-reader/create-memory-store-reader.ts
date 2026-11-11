import type { CheckedDeployment, ConsumersDB, StoreReader } from '@pepys/kit';
import { createTursoDialect } from '@pepys/kysely-turso';
import type { Database } from '@tursodatabase/database';
import { Kysely } from 'kysely';

// The memory adapter of the store reader port. `markDown` gives a test the path of a consumer with
// no current version.
export interface MemoryStoreReader extends StoreReader {
  markDown: (consumer: string) => void;
}

// One database holds every consumer, so the two shared views show the rows of every consumer, the
// ones a call does not attach included. Each call runs in a transaction that rolls back, so a
// handler keeps nothing it writes. The test store owns the database and closes it.
export function createMemoryStoreReader(
  database: Database,
  deployment: CheckedDeployment,
): MemoryStoreReader {
  const down = new Set<string>();
  const deployed = new Set(deployment.consumers.map((consumer) => consumer.name));

  const isCurrent = (name: string) => deployed.has(name) && !down.has(name);

  return {
    markDown: (consumer) => {
      down.add(consumer);
    },
    withConsumers: async (consumers, work, options) => {
      const missing = consumers.map((consumer) => consumer.name).filter((name) => !isCurrent(name));

      if (missing.length > 0) {
        return { ok: false, failure: { reason: 'no-current-version', consumers: missing } };
      }

      const optional = (options?.whenCurrent ?? []).map((consumer) => consumer.name);

      const attached = [
        ...consumers.map((consumer) => consumer.name),
        ...optional.filter((name) => isCurrent(name)),
      ];

      const db = new Kysely<ConsumersDB<typeof consumers>>({
        dialect: createTursoDialect({ database: () => Promise.resolve(database) }),
      });

      const transaction = await db.startTransaction().execute();

      try {
        const value = await work(transaction, {
          attached: Object.fromEntries(attached.map((name) => [name, { version: 'memory' }])),
          skipped: optional.filter((name) => !isCurrent(name)),
        });

        return { ok: true, value };
      } finally {
        await transaction.rollback().execute();
      }
    },
    close: () => Promise.resolve(),
  };
}
