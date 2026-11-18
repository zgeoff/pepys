import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { createSyncedFolder } from '../create-synced-folder.ts';
import { syncFolder } from '../sync-folder.ts';
import type { FailedLine } from './types.ts';

// Appends one refused line to the `failed` file of the spool file's day, and returns once the line
// and the file's name are on disk.
export async function appendFailedLine(
  folder: string,
  spoolFileName: string,
  failedLine: FailedLine,
): Promise<void> {
  const failedFolder = join(folder, 'failed');

  await createSyncedFolder(failedFolder, 0o700);

  const file = await open(join(failedFolder, spoolFileName), 'a', 0o600);

  try {
    await file.appendFile(`${JSON.stringify(failedLine)}\n`);
    await file.sync();
  } finally {
    await file.close();
  }

  await syncFolder(failedFolder);
}
