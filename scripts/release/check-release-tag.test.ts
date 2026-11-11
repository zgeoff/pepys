import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { stopProcessGroup } from '../utils/stop-process-group.ts';

function setupTest() {
  return {
    runScript: async (tag: string) => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'check-release-tag.ts')], {
        env: { RELEASE_TAG: tag },
        stdout: 'pipe',
        stderr: 'pipe',
        detached: true,
      });

      onTestFinished(() => stopProcessGroup(child));

      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);

      return { exitCode, stderr };
    },
    readKitVersion: async () => {
      const manifest: unknown = await Bun.file(
        join(import.meta.dir, '..', '..', 'packages', 'kit', 'package.json'),
      ).json();

      const version: unknown =
        typeof manifest === 'object' && manifest !== null
          ? Reflect.get(manifest, 'version')
          : undefined;

      invariant(typeof version === 'string', 'the kit has a version');

      return version;
    },
  };
}

test('it passes a tag that carries the version of every public package', async () => {
  const ctx = setupTest();

  const version = await ctx.readKitVersion();
  const result = await ctx.runScript(`v${version}`);

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
});

test('it fails a tag of another version and names a package it does not match', async () => {
  const ctx = setupTest();

  const result = await ctx.runScript('v999.0.0');

  expect(result).toStrictEqual({
    exitCode: 1,
    stderr: expect.stringContaining('the tag v999.0.0 needs 999.0.0'),
  });
});
