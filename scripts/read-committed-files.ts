import { join } from 'node:path';
import type { GeneratedFile } from './build-generated-files.ts';

// The committed text of each generated file, by its path under `root`. A path with no file, such
// as a missing one or a folder, has no entry, so the check reports it as stale.
export async function readCommittedFiles(
  root: string,
  files: readonly GeneratedFile[],
): Promise<Map<string, string>> {
  const texts = await Promise.all(
    files.map(async (file) => {
      const handle = Bun.file(join(root, file.path));

      const exists = await handle.exists();

      return exists ? [[file.path, await handle.text()] as const] : [];
    }),
  );

  return new Map(texts.flat());
}
