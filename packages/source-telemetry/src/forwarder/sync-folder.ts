import { open } from 'node:fs/promises';

// A new or renamed file survives a power failure only once the folder that lists it is on disk:
// a sync of the file alone leaves its name in memory.
export async function syncFolder(path: string): Promise<void> {
  const folder = await open(path, 'r');

  try {
    await folder.sync();
  } finally {
    await folder.close();
  }
}
