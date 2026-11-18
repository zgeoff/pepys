import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Positions } from './types.ts';

// A write to a temporary file, then a rename, so that a reader never sees half a file.
export async function writePositions(folder: string, positions: Positions): Promise<void> {
  const temporary = join(folder, 'positions.json.tmp');

  await writeFile(temporary, JSON.stringify(positions), { mode: 0o600 });
  await rename(temporary, join(folder, 'positions.json'));
}
