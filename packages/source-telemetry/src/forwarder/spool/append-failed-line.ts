import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { FailedLine } from './types.ts';

// Appends one refused line to the `failed` file of the spool file's day.
export async function appendFailedLine(
  folder: string,
  spoolFileName: string,
  failedLine: FailedLine,
): Promise<void> {
  const failedFolder = join(folder, 'failed');

  await mkdir(failedFolder, { recursive: true, mode: 0o700 });

  await appendFile(join(failedFolder, spoolFileName), `${JSON.stringify(failedLine)}\n`, {
    mode: 0o600,
  });
}
