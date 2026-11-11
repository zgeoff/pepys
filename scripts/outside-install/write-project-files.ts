import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

// Writes each file under `project`, by its path relative to the project's folder.
export async function writeProjectFiles(
  project: string,
  files: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(project, path)), { recursive: true });

    await Bun.write(join(project, path), content);
  }
}
