import { expect, onTestFinished, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { stopProcessGroup } from '../utils/stop-process-group.ts';
import { readPublicPackages } from './read-public-packages.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await mkdtemp(join(tmpdir(), 'pepys-publish-'));

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const binDirectory = join(directory, 'bin');
  const log = join(directory, 'npm.log');

  // A stand-in npm on PATH: `view` answers for the one package and version in PUBLISHED, and fails
  // with E404 for any other, as npm does for a package it has never seen; every call is logged.
  await Bun.write(
    join(binDirectory, 'npm'),
    `#!/bin/sh
echo "$*" >> "$NPM_LOG"
if [ "$1" = view ]; then
  if [ "$2" = "$PUBLISHED" ]; then echo "\${PUBLISHED##*@}"; exit 0; fi
  echo "npm error code E404" >&2
  exit 1
fi
exit "\${PUBLISH_EXIT:-0}"
`,
  );

  await chmod(join(binDirectory, 'npm'), 0o755);

  return {
    packDirectory: join(directory, 'packs'),
    readPackages: () => readPublicPackages(join(import.meta.dir, '..', '..')),
    readLog: () => Bun.file(log).text(),
    runScript: async (env: Record<string, string>) => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'publish-packages.ts')], {
        env: { PATH: `${binDirectory}:${process.env['PATH'] ?? ''}`, NPM_LOG: log, ...env },
        stdout: 'pipe',
        stderr: 'pipe',
        detached: true,
      });

      stack.defer(() => stopProcessGroup(child));

      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);

      return { exitCode, stderr };
    },
  };
}

test('it publishes each tarball with provenance and skips a version npm has', async () => {
  const ctx = await setupTest();
  const [first, ...rest] = await ctx.readPackages();

  invariant(first, 'the repo has a public package');

  const result = await ctx.runScript({
    PEPYS_PACK_DIR: ctx.packDirectory,
    PUBLISHED: `${first.name}@${first.version}`,
  });

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });

  const log = await ctx.readLog();

  expect(log.split('\n').filter((line) => line.startsWith('publish'))).toStrictEqual(
    rest.map(
      (pkg) =>
        `publish ${join(ctx.packDirectory, `${pkg.name.slice(1).replace('/', '-')}-${pkg.version}.tgz`)} --provenance --access public`,
    ),
  );
});

test('it fails when npm refuses a publish', async () => {
  const ctx = await setupTest();

  const result = await ctx.runScript({
    PEPYS_PACK_DIR: ctx.packDirectory,
    PUBLISHED: 'none',
    PUBLISH_EXIT: '1',
  });

  expect(result).toStrictEqual({
    exitCode: 1,
    stderr: expect.stringContaining('npm publish failed for @pepys/'),
  });
});

test('it fails with no PEPYS_PACK_DIR', async () => {
  const ctx = await setupTest();
  const result = await ctx.runScript({});

  expect(result).toStrictEqual({ exitCode: 1, stderr: 'needs PEPYS_PACK_DIR set\n' });
});
