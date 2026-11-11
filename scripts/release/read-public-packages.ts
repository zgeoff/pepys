import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { isRecord } from '../utils/is-record.ts';

export interface PublicPackage {
  name: string;
  version: string;
  folder: string;

  // each import path the package exports, such as `@pepys/kit/send`
  entries: readonly string[];
}

// Reads every package under `packages/` that is not private, in folder order.
export async function readPublicPackages(root: string): Promise<PublicPackage[]> {
  const folderNames = await readdir(join(root, 'packages'));

  const manifests = await Promise.all(
    folderNames.toSorted().map(async (folderName) => {
      const folder = join(root, 'packages', folderName);

      const manifest: unknown = await Bun.file(join(folder, 'package.json')).json();

      return { folder, manifest };
    }),
  );

  return collectPublicPackages(manifests);
}

export function collectPublicPackages(
  manifests: readonly { folder: string; manifest: unknown }[],
): PublicPackage[] {
  return manifests.flatMap((entry) => {
    const manifest = entry.manifest;

    if (!isRecord(manifest) || manifest['private'] === true) {
      return [];
    }

    const name = manifest['name'];
    const version = manifest['version'];

    if (typeof name !== 'string' || typeof version !== 'string') {
      throw new TypeError(`${entry.folder}/package.json is public and lacks a name or a version`);
    }

    return [
      { name, version, folder: entry.folder, entries: collectEntries(name, manifest['exports']) },
    ];
  });
}

function collectEntries(name: string, exports: unknown): string[] {
  if (!isRecord(exports)) {
    return [name];
  }

  return Object.keys(exports).map((subpath) =>
    subpath === '.' ? name : `${name}/${subpath.slice(2)}`,
  );
}
