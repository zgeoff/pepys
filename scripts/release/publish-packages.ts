// Publishes each tarball in PEPYS_PACK_DIR with npm, through trusted publishing. A version that npm
// already has is skipped, so a rerun after a failed publish sends only what is left.
import { join } from 'node:path';
import { buildTarballName } from './build-tarball-name.ts';
import { readPublicPackages } from './read-public-packages.ts';

const packDirectory = process.env['PEPYS_PACK_DIR'];

if (packDirectory === undefined || packDirectory === '') {
  console.error('needs PEPYS_PACK_DIR set');
  process.exit(1);
}

const packages = await readPublicPackages(join(import.meta.dir, '..', '..'));

for (const pkg of packages) {
  const isPublished = await probePublished(pkg.name, pkg.version);

  if (isPublished) {
    console.log(`${pkg.name}@${pkg.version} is on npm already`);
    continue;
  }

  // `bun publish` has no trusted publishing, so npm publishes the tarball that bun packed
  const tarball = join(packDirectory, buildTarballName(pkg));

  const exitCode = await Bun.spawn(
    ['npm', 'publish', tarball, '--provenance', '--access', 'public'],
    { stdout: 'inherit', stderr: 'inherit' },
  ).exited;

  if (exitCode !== 0) {
    console.error(`npm publish failed for ${pkg.name}@${pkg.version} with exit code ${exitCode}`);
    process.exit(1);
  }
}

// `npm view` prints the version when npm has it, prints nothing for a missing version of a known
// package, and fails with E404 for a package npm has never seen.
async function probePublished(name: string, version: string): Promise<boolean> {
  const child = Bun.spawn(['npm', 'view', `${name}@${version}`, 'version'], {
    stdout: 'pipe',
    stderr: 'ignore',
  });

  const [output, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);

  return exitCode === 0 && output.trim() === version;
}
