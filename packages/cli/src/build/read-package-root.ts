import { dirname, resolve } from 'node:path';

// The nearest folder at or above the start that holds a package.json, or undefined when none does.
export async function readPackageRoot(start: string): Promise<string | undefined> {
  let folder = start;

  while (!(await Bun.file(resolve(folder, 'package.json')).exists())) {
    const parent = dirname(folder);

    if (parent === folder) {
      return undefined;
    }

    folder = parent;
  }

  return folder;
}
