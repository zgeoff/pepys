// Installs every public `@pepys/*` package into a new folder outside the repo, then type-checks a
// stub plug-in there and runs its query test. The packages come from the tarballs in
// PEPYS_PACK_DIR, from npm at PEPYS_OUTSIDE_VERSION, or, with neither set, from a fresh pack.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildOutsideProject } from './build-outside-project.ts';
import { readOutsideInputs } from './read-outside-inputs.ts';
import { runStep } from './run-step.ts';
import { writeProjectFiles } from './write-project-files.ts';

const root = join(import.meta.dir, '..', '..');

// os.tmpdir() has no package.json or node_modules above it, so nothing from the repo resolves there
const directory = await mkdtemp(join(tmpdir(), 'pepys-outside-'));

const project = join(directory, 'project');

try {
  const input = await readOutsideInputs(root, directory);

  await writeProjectFiles(project, buildOutsideProject(input));

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
