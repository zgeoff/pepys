import { join } from 'node:path';
import { buildTarballName } from '../release/build-tarball-name.ts';
import type { PublicPackage } from '../release/read-public-packages.ts';
import type { OutsideSource } from './build-outside-project.ts';

export interface OutsideSourceInput {
  packages: readonly PublicPackage[];

  // PEPYS_OUTSIDE_VERSION: a version to install from npm
  version: string | undefined;

  // PEPYS_PACK_DIR: a folder that holds a tarball of each package
  packDirectory: string | undefined;
}

// `pack` means no source is set, so the check packs the packages itself
export type OutsideSourceStep = OutsideSource | { kind: 'pack' };

// Picks where the outside project takes the packages from: npm at a version, the tarballs in a
// folder, or a fresh pack. An empty variable counts as unset, and a version wins over a folder.
export function pickOutsideSource(input: OutsideSourceInput): OutsideSourceStep {
  if (input.version !== undefined && input.version !== '') {
    return { kind: 'npm', version: input.version };
  }

  const packDirectory = input.packDirectory;

  if (packDirectory === undefined || packDirectory === '') {
    return { kind: 'pack' };
  }

  return {
    kind: 'tarballs',
    tarballs: Object.fromEntries(
      input.packages.map((pkg) => [pkg.name, join(packDirectory, buildTarballName(pkg))]),
    ),
  };
}
