import type { PublicPackage } from './read-public-packages.ts';

// A release tag is `v<version>`, and every public package carries that version, so a deployment
// pins one version for all of them. Returns one line for each package that does not.
export function collectVersionMismatches(
  packages: readonly Pick<PublicPackage, 'name' | 'version'>[],
  tag: string,
): string[] {
  if (!tag.startsWith('v')) {
    return [`the tag ${tag} is not v<version>`];
  }

  const version = tag.slice(1);

  return packages
    .filter((pkg) => pkg.version !== version)
    .map((pkg) => `${pkg.name} is at ${pkg.version}, and the tag ${tag} needs ${version}`);
}
