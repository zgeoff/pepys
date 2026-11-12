import { realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { ConsumerDeclaration, ConsumersDB, StoreReader } from '@pepys/kit';
import { createTursoDialect } from '@pepys/kysely-turso';
import { connect } from '@tursodatabase/database';
import type { Database } from '@tursodatabase/database';
import { Kysely } from 'kysely';
import { createActor } from 'xstate';
import type { Actor } from 'xstate';
import { buildSharedViewsPlugin } from './build-shared-views-plugin.ts';
import { pickAttachedFiles } from './pick-attached-files.ts';
import type { AttachedFile, CurrentFile } from './pick-attached-files.ts';
import { storeFileMachine } from './store-file-machine.ts';

interface StoreReaderOptions {
  storeDirectory: string;
}

type OpenedFile = { ok: true; database: Database } | { ok: false; error: unknown };

// One open read-only handle on a consumer file. Turso 0.8.3 refuses to attach a file that the
// host holds open with its multi-process WAL, unless this process holds a handle of its own.
interface FileKeeper {
  consumer: string;
  path: string;
  opened: Promise<OpenedFile>;
  lifecycle: Actor<typeof storeFileMachine>;
}

// The Turso adapter of the store reader port. Each call opens one connection on an empty
// in-memory database, attaches the current file of each consumer read-only under the consumer's
// name, and runs the work in one transaction, which holds one snapshot of each file.
export function createStoreReader(options: StoreReaderOptions): StoreReader {
  const current = new Map<string, FileKeeper>();
  const unclosed = new Set<FileKeeper>();

  // The current file leaves the map when it retires, so the next call opens the path again.
  const retireKeeper = (keeper: FileKeeper): void => {
    if (current.get(keeper.consumer) === keeper) {
      current.delete(keeper.consumer);
    }

    keeper.lifecycle.send({ type: 'retire' });
  };

  const holdKeeper = (file: AttachedFile): FileKeeper => {
    const held = current.get(file.consumer.name);

    if (held?.path === file.path) {
      held.lifecycle.send({ type: 'hold' });

      return held;
    }

    const keeper: FileKeeper = {
      consumer: file.consumer.name,
      path: file.path,
      opened: openFile(file.path),
      lifecycle: createActor(storeFileMachine).start(),
    };

    keeper.lifecycle.send({ type: 'hold' });
    current.set(file.consumer.name, keeper);
    unclosed.add(keeper);

    // the host swapped the version: the old file closes once its last call ends
    if (held !== undefined) {
      retireKeeper(held);
    }

    return keeper;
  };

  // A retired file may have had no call open when the host swapped it, so each call that ends
  // closes every idle retired file, not only the files it held.
  const releaseKeepers = async (held: readonly FileKeeper[]): Promise<void> => {
    for (const keeper of held) {
      keeper.lifecycle.send({ type: 'release' });
    }

    const idle = [...unclosed].filter((keeper) =>
      keeper.lifecycle.getSnapshot().matches('retiredIdle'),
    );

    await Promise.all(idle.map((keeper) => closeKeeper(keeper)));
  };

  // A file that fails to open retires, and closes once the calls that hold it end.
  const readOpenedFiles = async (held: readonly FileKeeper[]): Promise<void> => {
    const opened = await Promise.all(
      held.map(async (keeper) => ({ keeper, file: await keeper.opened })),
    );

    const errors = opened.flatMap((entry) => {
      if (entry.file.ok) {
        return [];
      }

      retireKeeper(entry.keeper);

      return [entry.file.error];
    });

    if (errors.length > 0) {
      throw errors[0];
    }
  };

  // The file leaves the set before its database closes, so two sweeps never close it twice.
  const closeKeeper = async (keeper: FileKeeper): Promise<void> => {
    keeper.lifecycle.send({ type: 'close' });
    unclosed.delete(keeper);

    const file = await keeper.opened;

    // a file that failed to open has nothing to close, and its call already threw the error
    if (file.ok) {
      await file.database.close();
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
        await readOpenedFiles(held);

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
              plan.files.map((file): [string, { version: string }] => [
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
        await releaseKeepers(held);
      }
    },
    close: async () => {
      current.clear();

      await Promise.all([...unclosed].map((keeper) => closeKeeper(keeper)));
    },
  };
}

async function openFile(path: string): Promise<OpenedFile> {
  try {
    const database = await connect(path, { readonly: true, experimental: ['multiprocess_wal'] });

    return { ok: true, database };
  } catch (error: unknown) {
    return { ok: false, error };
  }
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
