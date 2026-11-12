import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stopProcessGroup } from '../utils/stop-process-group.ts';
import { readPublicPackages } from './read-public-packages.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await mkdtemp(join(tmpdir(), 'pepys-tarballs-'));

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  return {
    packDirectory: join(directory, 'packs'),
    readPackages: () => readPublicPackages(join(import.meta.dir, '..', '..')),
    readTarballs: async () => {
      const names = await readdir(join(directory, 'packs'));

      return names.toSorted();
    },
    runScript: async (env: Record<string, string>) => {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, 'write-package-tarballs.ts')],
        {
          env: { PATH: process.env['PATH'] ?? '', ...env },
          stdout: 'ignore',
          stderr: 'pipe',
          detached: true,
        },
      );

      stack.defer(() => stopProcessGroup(child));

      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);

      return { exitCode, stderr };
    },
  };
}

test('it writes one tarball for each public package', async () => {
  const ctx = await setupTest();
  const packages = await ctx.readPackages();
  const result = await ctx.runScript({ PEPYS_PACK_DIR: ctx.packDirectory });

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });

  const tarballs = await ctx.readTarballs();

  expect(tarballs).toStrictEqual(
    packages.map((pkg) => `${pkg.name.slice(1).replace('/', '-')}-${pkg.version}.tgz`).toSorted(),
  );
});

test('it fails with no PEPYS_PACK_DIR', async () => {
  const ctx = await setupTest();
  const result = await ctx.runScript({});

  expect(result).toStrictEqual({ exitCode: 1, stderr: 'needs PEPYS_PACK_DIR set\n' });
});
