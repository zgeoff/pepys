import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { syncFolder } from '../sync-folder.ts';
import { writeSyncedFile } from '../write-synced-file.ts';
import type { Positions } from './types.ts';

// A write to a temporary file, then a rename, so that a reader never sees half a file. Each write
// has a temporary file of its own, and returns once the new positions.json is on disk.
export async function writePositions(folder: string, positions: Positions): Promise<void> {
  const temporary = join(folder, `positions.json.${randomUUID()}.tmp`);

  try {
    await writeSyncedFile(temporary, JSON.stringify(positions), { flag: 'wx', mode: 0o600 });
    await rename(temporary, join(folder, 'positions.json'));
  } catch (error) {
    await rm(temporary, { force: true });

    throw error;
  }

  await syncFolder(folder);
}
