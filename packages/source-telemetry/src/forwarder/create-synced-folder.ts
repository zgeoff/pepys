import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { syncFolder } from './sync-folder.ts';

const unreadableError = z.object({ code: z.literal('EACCES') });

// Makes the folder and any missing folder above it, then syncs each folder up to the root: an
// earlier process can stop before its syncs, and leaves no sign of which folders it made. It
// stops at a folder above that it cannot read; it gives each folder it makes the owner's read bit.
export async function createSyncedFolder(
  path: string,
  mode: number,
  sync: (folder: string) => Promise<void> = syncFolder,
): Promise<void> {
  await mkdir(path, { recursive: true, mode });

  const folder = resolve(path);
  let current = folder;

  for (;;) {
    try {
      await sync(current);
    } catch (error) {
      if (current !== folder && unreadableError.safeParse(error).success) {
        return;
      }

      throw error;
    }

    const parent = dirname(current);

    if (parent === current) {
      return;
    }

    current = parent;
  }
}
