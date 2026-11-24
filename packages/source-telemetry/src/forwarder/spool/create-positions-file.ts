import { readdir } from 'node:fs/promises';
import { collectSpoolFileNames } from './collect-spool-file-names.ts';
import { missingPositionsFailure, readPositions } from './read-positions.ts';
import { writePositions } from './write-positions.ts';

// Makes an empty positions.json for a spool with no file yet, so that the first run starts clean.
// With positions.json missing and a spool file there, it writes nothing: the send loop stops, and
// the owner decides whether to send the spool from its start.
export async function createPositionsFile(folder: string): Promise<void> {
  const positions = await readPositions(folder);

  if (positions.ok || positions.failure !== missingPositionsFailure) {
    return;
  }

  const names = await readdir(folder);

  if (collectSpoolFileNames(names).length === 0) {
    await writePositions(folder, {});
  }
}
