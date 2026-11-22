import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { createSyncedFolder } from '../create-synced-folder.ts';
import { syncFolder } from '../sync-folder.ts';
import { buildSpoolFileName } from './build-spool-file-name.ts';
import { toUTCDay } from './to-utc-day.ts';

interface SpoolAppenderOptions {
  folder: string;
  now: () => number;
}

// Appends one line to the spool file of the current UTC day, and returns once the bytes and the
// file's name are on disk. Appends run one at a time. A file that ends in a partial line gets a
// line break first, so the new line starts on a line of its own.
export function createSpoolAppender(
  options: SpoolAppenderOptions,
): (text: string) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();

  // An earlier process can stop between the making of a file and the sync of the folder, so the
  // first append of this process to each file syncs the folder, whoever made the file.
  let syncedName: string | null = null;

  return async (text) => {
    const previous = tail;
    const turn = Promise.withResolvers<void>();

    tail = turn.promise;

    await previous;

    try {
      const name = await writeLine(options, text);

      if (name !== syncedName) {
        await syncFolder(options.folder);

        syncedName = name;
      }
    } finally {
      turn.resolve();
    }
  };
}

// Returns the name of the file it appended to.
async function writeLine(options: SpoolAppenderOptions, text: string): Promise<string> {
  await createSyncedFolder(options.folder, 0o700);

  const name = buildSpoolFileName(toUTCDay(options.now()));

  const file = await open(join(options.folder, name), 'a+', 0o600);

  try {
    const stats = await file.stat();
    const complete = await endsWithLineBreak(file, stats.size);

    const prefix = complete ? '' : '\n';

    await file.appendFile(prefix + text);
    await file.sync();
  } finally {
    await file.close();
  }

  return name;
}

async function endsWithLineBreak(file: FileHandle, size: number): Promise<boolean> {
  if (size === 0) {
    return true;
  }

  const last = Buffer.alloc(1);

  await file.read(last, 0, 1, size - 1);

  return last[0] === 0x0a;
}
