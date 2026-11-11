// Packs every public package into PEPYS_PACK_DIR, once per release run: the outside install check
// and the publish read the same tarballs.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { readPublicPackages } from './read-public-packages.ts';
import { runPackPackages } from './run-pack-packages.ts';

const destination = process.env['PEPYS_PACK_DIR'];

if (destination === undefined || destination === '') {
  console.error('needs PEPYS_PACK_DIR set');
  process.exit(1);
}

await mkdir(destination, { recursive: true });

const packages = await readPublicPackages(join(import.meta.dir, '..', '..'));
const tarballs = await runPackPackages(packages, destination);

for (const tarball of Object.values(tarballs)) {
  console.log(tarball);
}
