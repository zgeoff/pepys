import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect } from '@tursodatabase/database';
import { pickStoreRead } from './pick-store-read.ts';

// The db driver's sqlite3. sqlite3 and bun:sqlite read a file of Turso's multi-process WAL as it was
// before the WAL, so this copies the consumer's current file with Turso's `VACUUM INTO`, and runs
// sqlite3 with the driver's flags and stdin on the copy.
export async function runStoreSqlite(argv: readonly string[]): Promise<number> {
  const read = pickStoreRead(argv);

  if (read.kind === 'refused') {
    process.stderr.write(`Error: ${read.message}\n`);

    return 1;
  }

  const copyDirectory = await mkdtemp(join(tmpdir(), 'pepys-verify-db-'));

  try {
    const copyPath = join(copyDirectory, 'consumer.db');

    await writeStoreCopy(read.consumerDirectory, copyPath);

    const child = Bun.spawn(['sqlite3', ...read.flags, copyPath], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });

    return await child.exited;
  } finally {
    await rm(copyDirectory, { recursive: true, force: true });
  }
}

async function writeStoreCopy(consumerDirectory: string, copyPath: string): Promise<void> {
  const current = await realpath(join(consumerDirectory, 'current'));

  const database = await connect(join(current, 'consumer.db'), {
    readonly: true,
    experimental: ['multiprocess_wal'],
  });

  try {
    await database.exec(`vacuum into '${copyPath.replaceAll("'", "''")}'`);
  } finally {
    await database.close();
  }
}

if (import.meta.main) {
  const exitCode = await runStoreSqlite(process.argv.slice(2));

  process.exit(exitCode);
}
