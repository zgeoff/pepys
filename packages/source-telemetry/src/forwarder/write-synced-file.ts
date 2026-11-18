import { open } from 'node:fs/promises';

interface SyncedFileOptions {
  // `wx` fails on a file that exists
  flag: 'w' | 'wx';
  mode: number;
}

// Writes the file and returns once its bytes are on disk. The caller syncs the folder, after a
// rename when it makes one.
export async function writeSyncedFile(
  path: string,
  text: string,
  options: SyncedFileOptions,
): Promise<void> {
  const file = await open(path, options.flag, options.mode);

  try {
    await file.writeFile(text);
    await file.sync();
  } finally {
    await file.close();
  }
}
