import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { collectSpoolFileNames } from './collect-spool-file-names.ts';

// The lines in the files under `failed/`.
export async function countFailedLines(folder: string): Promise<number> {
  const failedFolder = join(folder, 'failed');
  let names: string[];

  try {
    names = await readdir(failedFolder);
  } catch {
    return 0;
  }

  let count = 0;

  for (const name of collectSpoolFileNames(names)) {
    const text = await readFile(join(failedFolder, name), 'utf8');

    count += text.split('\n').filter((line) => line !== '').length;
  }

  return count;
}
