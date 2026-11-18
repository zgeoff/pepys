import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { syncFolder } from './sync-folder.ts';

// Makes the folder and each missing folder above it, and returns once their names are on disk. It
// syncs the folder above one that exists too: an earlier process can stop between the making of
// the folder and that sync.
export async function createSyncedFolder(path: string, mode: number): Promise<void> {
  const firstMade = await mkdir(path, { recursive: true, mode });

  const folder = resolve(path);

  if (firstMade === undefined) {
    await syncFolder(dirname(folder));

    return;
  }

  // `mkdir` returns a relative path for a relative one
  const listing = dirname(resolve(firstMade));
  let current = folder;

  for (;;) {
    await syncFolder(current);

    const parent = dirname(current);

    if (current === listing || parent === current) {
      return;
    }

    current = parent;
  }
}
