// Installs every public `@pepys/*` package into a new folder outside the repo, then type-checks a
// stub plug-in there and runs its query test. The packages come from the tarballs in
// PEPYS_PACK_DIR, from npm at PEPYS_OUTSIDE_VERSION, or, with neither set, from a fresh pack.
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildTarballName } from '../release/build-tarball-name.ts';
import { readPublicPackages } from '../release/read-public-packages.ts';
import type { PublicPackage } from '../release/read-public-packages.ts';
import { runPackPackages } from '../release/run-pack-packages.ts';
import { isRecord } from '../utils/is-record.ts';
import { buildOutsideProject } from './build-outside-project.ts';
import type { OutsideSource } from './build-outside-project.ts';

const root = join(import.meta.dir, '..', '..');

const packages = await readPublicPackages(root);
const catalog = await readCatalog(root);
const releaseAgeExcludes = await readReleaseAgeExcludes(root);

// os.tmpdir() has no package.json or node_modules above it, so nothing from the repo resolves there
const directory = await mkdtemp(join(tmpdir(), 'pepys-outside-'));

const project = join(directory, 'project');

try {
  const source = await readSource(packages, directory);

  for (const [path, content] of Object.entries(
    buildOutsideProject({ packages, source, catalog, releaseAgeExcludes }),
  )) {
    await mkdir(dirname(join(project, path)), { recursive: true });

    await Bun.write(join(project, path), content);
  }

  // a fresh cache, so a repacked tarball of an unchanged version cannot come from an older install
  await runStep(project, [process.execPath, 'install', '--cache-dir', join(directory, 'cache')]);

  await runStep(project, [
    process.execPath,
    join(project, 'node_modules/typescript/bin/tsc'),
    '-p',
    '.',
  ]);

  await runStep(project, [process.execPath, 'test']);
} finally {
  await rm(directory, { recursive: true, force: true });
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

async function runStep(cwd: string, command: readonly string[]): Promise<void> {
  const exitCode = await Bun.spawn([...command], { cwd, stdout: 'inherit', stderr: 'inherit' })
    .exited;

  if (exitCode !== 0) {
    throw new Error(`${command.join(' ')} exited with ${exitCode}`);
  }
}
