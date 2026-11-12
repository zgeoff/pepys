import { join } from 'node:path';
import { buildTarballName } from './build-tarball-name.ts';
import type { PublicPackage } from './read-public-packages.ts';

export interface PublishStepInput {
  pkg: PublicPackage;

  // whether npm has the package at its version
  isPublished: boolean;

  packDirectory: string;
}

export type PublishStep = { kind: 'skip'; message: string } | { kind: 'publish'; tarball: string };

// A version that npm has already is skipped, so a rerun after a failed publish sends only what is
// left. Any other version publishes the tarball that bun packed.
export function pickPublishStep(input: PublishStepInput): PublishStep {
  if (input.isPublished) {
    return { kind: 'skip', message: `${input.pkg.name}@${input.pkg.version} is on npm already` };
  }

  return { kind: 'publish', tarball: join(input.packDirectory, buildTarballName(input.pkg)) };
}
