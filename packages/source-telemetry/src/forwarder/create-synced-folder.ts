import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { syncFolder } from './sync-folder.ts';

// Makes the folder and each missing folder above it, and returns once their names are on disk. A
// folder that exists costs one `mkdir` and no sync.
export async function createSyncedFolder(path: string, mode: number): Promise<void> {
  const firstMade = await mkdir(path, { recursive: true, mode });

  if (firstMade === undefined) {
    return;
  }

  const listing = dirname(firstMade);
  let current = resolve(path);

  for (;;) {
    await syncFolder(current);

    const parent = dirname(current);

    if (current === listing || parent === current) {
      return;
    }

    current = parent;
  }
}
