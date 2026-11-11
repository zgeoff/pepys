import { join } from 'node:path';
import { buildTarballName } from './build-tarball-name.ts';
import type { PublicPackage } from './read-public-packages.ts';

// `bun pm pack` rewrites each `workspace:` and `catalog:` range to the version it stands for, which
// `npm pack` ships as it is. Returns the path of each tarball, by package name.
export async function runPackPackages(
  packages: readonly PublicPackage[],
  destination: string,
): Promise<Record<string, string>> {
  const tarballs: Record<string, string> = {};

  for (const pkg of packages) {
    const child = Bun.spawn(
      [process.execPath, 'pm', 'pack', '--destination', destination, '--quiet'],
      { cwd: pkg.folder, stdout: 'ignore', stderr: 'inherit' },
    );

    const exitCode = await child.exited;

    if (exitCode !== 0) {
      throw new Error(`bun pm pack failed for ${pkg.name} with exit code ${exitCode}`);
    }

    tarballs[pkg.name] = join(destination, buildTarballName(pkg));
  }

  return tarballs;
}
