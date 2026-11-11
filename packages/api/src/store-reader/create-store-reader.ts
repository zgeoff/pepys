import { realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ConsumerDeclaration, ConsumersDB, StoreReader } from '@pepys/kit';
import { createTursoDialect } from '@pepys/kysely-turso';
import { connect } from '@tursodatabase/database';
import type { Database } from '@tursodatabase/database';
import { Kysely } from 'kysely';
import { buildSharedViewsPlugin } from './build-shared-views-plugin.ts';
import { pickAttachedFiles } from './pick-attached-files.ts';
import type { AttachedFile, CurrentFile } from './pick-attached-files.ts';

interface StoreReaderOptions {
  storeDirectory: string;
}

// One open read-only handle on a consumer file. Turso 0.8.3 refuses to attach a file that the
// host holds open with its multi-process WAL, unless this process holds a handle of its own.
interface FileKeeper {
  path: string;
  database: Promise<Database>;
  readers: number;
  isRetired: boolean;
}

// The Turso adapter of the store reader port. Each call opens one connection on an empty
// in-memory database, attaches the current file of each consumer read-only under the consumer's
// name, and runs the work in one transaction, which holds one snapshot of each file.
export function createStoreReader(options: StoreReaderOptions): StoreReader {
  const keepers = new Map<string, FileKeeper>();
  const retired = new Set<FileKeeper>();

  const holdKeeper = (file: AttachedFile): FileKeeper => {
    const held = keepers.get(file.consumer.name);

    if (held?.path === file.path) {
      held.readers += 1;

      return held;
    }

    const keeper: FileKeeper = {
      path: file.path,
      database: connect(file.path, { readonly: true, experimental: ['multiprocess_wal'] }),
      readers: 1,
      isRetired: false,
    };

    keepers.set(file.consumer.name, keeper);

    // the host swapped the version: the old file closes once its last call ends
    if (held !== undefined) {
      held.isRetired = true;

      retired.add(held);
    }

    return keeper;
  };

  const releaseKeeper = async (keeper: FileKeeper): Promise<void> => {
    keeper.readers -= 1;

    if (keeper.isRetired && keeper.readers === 0 && retired.delete(keeper)) {
      const database = await keeper.database;

      await database.close();
    }
  };

  return {
    withConsumers: async (consumers, work, callOptions) => {
      // every file resolves before anything opens, so a swap during the call changes nothing
      const [required, optional] = await Promise.all([
        readCurrentFiles(options.storeDirectory, consumers),
        readCurrentFiles(options.storeDirectory, callOptions?.whenCurrent ?? []),
      ]);

      const plan = pickAttachedFiles(required, optional);

      if (plan.kind === 'missing') {
        return { ok: false, failure: { reason: 'no-current-version', consumers: plan.consumers } };
      }

      const held = plan.files.map((file) => holdKeeper(file));

      try {
        await Promise.all(held.map((keeper) => keeper.database));

        const connection = await connect(':memory:', { experimental: ['attach'] });

        const db = new Kysely<ConsumersDB<typeof consumers>>({
          dialect: createTursoDialect({ database: () => Promise.resolve(connection) }),
        });

        try {
          for (const file of plan.files) {
            await connection.exec(formatAttachStatement(file));
          }

          const call = {
            attached: Object.fromEntries(
              plan.files.map((file) => [
                file.consumer.name,
                { version: basename(dirname(file.path)) },
              ]),
            ),
            skipped: plan.skipped,
          };

          const views = buildSharedViewsPlugin(plan.files.map((file) => file.consumer));

          // A failed write ends Turso's transaction itself, and Kysely's own rollback would then
          // fail and hide the first error, so the call opens and ends the transaction by hand.
          await connection.exec('begin');

          try {
            const value = await work(db.withPlugin(views), call);

            return { ok: true, value };
          } finally {
            if (connection.inTransaction) {
              await connection.exec('rollback');
            }
          }
        } finally {
          await db.destroy();
        }
      } finally {
        await Promise.all(held.map((keeper) => releaseKeeper(keeper)));
      }
    },
    close: async () => {
      const open = [...keepers.values(), ...retired];

      keepers.clear();
      retired.clear();

      await Promise.all(
        open.map(async (keeper) => {
          const database = await keeper.database;

          await database.close();
        }),
      );
    },
  };
}

function readCurrentFiles(
  storeDirectory: string,
  consumers: readonly ConsumerDeclaration[],
): Promise<CurrentFile[]> {
  return Promise.all(
    consumers.map(async (consumer) => {
      const path = await readRealPath(
        join(storeDirectory, consumer.name, 'current', 'consumer.db'),
      );

      return { consumer, path };
    }),
  );
}

async function readRealPath(path: string): Promise<string | null> {
  try {
    const resolved = await realpath(path);

    return resolved;
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
}

// A URI opens the file read-only. The path is percent-encoded, so a `?`, `#`, `%` or quote in a
// folder name stays part of the path.
function formatAttachStatement(file: AttachedFile): string {
  const encoded = encodeURI(file.path)
    .replaceAll('?', '%3F')
    .replaceAll('#', '%23')
    .replaceAll("'", '%27');

  return `ATTACH 'file:${encoded}?mode=ro' AS "${file.consumer.name.replaceAll('"', '""')}"`;
}
