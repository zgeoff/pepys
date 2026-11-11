// Fails the release unless every public package carries the version of the tag in RELEASE_TAG.
import { join } from 'node:path';
import { collectVersionMismatches } from './collect-version-mismatches.ts';
import { readPublicPackages } from './read-public-packages.ts';

const packages = await readPublicPackages(join(import.meta.dir, '..', '..'));

const mismatches = collectVersionMismatches(packages, process.env['RELEASE_TAG'] ?? '');

for (const mismatch of mismatches) {
  console.error(mismatch);
}

const exitCode = mismatches.length === 0 ? 0 : 1;

process.exit(exitCode);
