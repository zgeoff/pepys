import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildTarballName } from '../release/build-tarball-name.ts';
import { readPublicPackages } from '../release/read-public-packages.ts';
import type { PublicPackage } from '../release/read-public-packages.ts';
import { runPackPackages } from '../release/run-pack-packages.ts';
import { isRecord } from '../utils/is-record.ts';
import type { OutsideProjectInput, OutsideSource } from './build-outside-project.ts';

// Reads what an outside project needs from the repo at `repoRoot`. The packages come from the
// tarballs in PEPYS_PACK_DIR, from npm at PEPYS_OUTSIDE_VERSION, or, with neither set, from a fresh
// pack into `folder`.
export async function readOutsideInputs(
  repoRoot: string,
  folder: string,
): Promise<OutsideProjectInput> {
  const packages = await readPublicPackages(repoRoot);
  const catalog = await readCatalog(repoRoot);
  const releaseAgeExcludes = await readReleaseAgeExcludes(repoRoot);
  const source = await readSource(packages, folder);

  return { packages, source, catalog, releaseAgeExcludes };
}

async function readCatalog(repoRoot: string): Promise<Record<string, string>> {
  const manifest: unknown = await Bun.file(join(repoRoot, 'package.json')).json();

  const workspaces = isRecord(manifest) ? manifest['workspaces'] : undefined;
  const catalogValue = isRecord(workspaces) ? workspaces['catalog'] : undefined;

  if (!isRecord(catalogValue)) {
    throw new Error('the root package.json has no workspaces.catalog');
  }

  return Object.fromEntries(
    Object.entries(catalogValue).flatMap(([name, pin]) =>
      typeof pin === 'string' ? [[name, pin]] : [],
    ),
  );
}

async function readReleaseAgeExcludes(repoRoot: string): Promise<string[]> {
  const bunfigText = await Bun.file(join(repoRoot, 'bunfig.toml')).text();

  const bunfig: unknown = Bun.TOML.parse(bunfigText);
  const install = isRecord(bunfig) ? bunfig['install'] : undefined;
  const excludes: unknown = isRecord(install) ? install['minimumReleaseAgeExcludes'] : undefined;

  if (!Array.isArray(excludes)) {
    throw new TypeError('the root bunfig.toml has no install.minimumReleaseAgeExcludes');
  }

  const listed: readonly unknown[] = excludes;

  return listed.filter((name) => typeof name === 'string');
}

async function readSource(
  publicPackages: readonly PublicPackage[],
  folder: string,
): Promise<OutsideSource> {
  const version = process.env['PEPYS_OUTSIDE_VERSION'];
  const packDirectory = process.env['PEPYS_PACK_DIR'];

  if (version !== undefined && version !== '') {
    return { kind: 'npm', version };
  }

  if (packDirectory !== undefined && packDirectory !== '') {
    const tarballs: Record<string, string> = {};

    for (const pkg of publicPackages) {
      tarballs[pkg.name] = join(packDirectory, buildTarballName(pkg));
    }

    return { kind: 'tarballs', tarballs };
  }

  const destination = join(folder, 'tarballs');

  await mkdir(destination);

  const tarballs = await runPackPackages(publicPackages, destination);

  return { kind: 'tarballs', tarballs };
}
