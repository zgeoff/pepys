import type { PublicPackage } from './read-public-packages.ts';

// the file name that `bun pm pack` gives a package's tarball
export function buildTarballName(pkg: Pick<PublicPackage, 'name' | 'version'>): string {
  return `${pkg.name.replace(/^@/u, '').replace('/', '-')}-${pkg.version}.tgz`;
}
