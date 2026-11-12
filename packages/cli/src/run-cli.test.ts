import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildStubPluginSource } from './test-utils/build-stub-plugin-source.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const root = await mkdtemp(join(tmpdir(), 'pepys-bin-'));

  stack.defer(() => rm(root, { recursive: true, force: true }));

  await mkdir(join(root, 'src'), { recursive: true });

  await Bun.write(join(root, 'package.json'), '{ "name": "stub-plugin", "type": "module" }');
  await Bun.write(join(root, 'src/plugin.ts'), buildStubPluginSource(['title']));

  return {
    root,
    runBin: async (args: string[], env: Record<string, string | undefined> = {}) => {
      const child = Bun.spawn(['bun', join(import.meta.dir, 'bin.ts'), ...args], {
        env: { ...process.env, PEPYS_HOST_BIN: undefined, ...env },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      stack.defer(async () => {
        child.kill();

        await child.exited;
      });

      const [stdout, stderr, exitCode] = await Promise.all([
        child.stdout.text(),
        child.stderr.text(),
        child.exited,
      ]);

      return { stdout, stderr, exitCode };
    },
  };
}

test('it exits 1 under --check on stale glue and 0 after a build', async () => {
  const ctx = await setupTest();

  const file = join(ctx.root, 'src/plugin.ts');

  const stale = await ctx.runBin(['build', file, '--check']);
  const built = await ctx.runBin(['build', file]);
  const fresh = await ctx.runBin(['build', file, '--check']);

  expect([stale.exitCode, built.exitCode, fresh.exitCode]).toStrictEqual([1, 0, 0]);
  expect(stale.stderr).toContain('stub-tickets.sql');
});

test('it exits 1 with the usage on no arguments', async () => {
  const ctx = await setupTest();
  const result = await ctx.runBin([]);

  expect(result).toStrictEqual({
    stdout: '',
    stderr:
      'usage: pepys build <file> [--out <directory>] [--check]\nusage: pepys start <deployment-file>\n',
    exitCode: 1,
  });
});

test('it exits 1 and names PEPYS_HOST_BIN when start finds it unset', async () => {
  const ctx = await setupTest();
  const result = await ctx.runBin(['start', join(ctx.root, 'src/plugin.ts')]);

  expect(result).toStrictEqual({
    stdout: '',
    stderr: 'pepys start needs PEPYS_HOST_BIN, the path of the host binary\n',
    exitCode: 1,
  });
});

test('it exits 1 when the file start loads exports a plug-in, not a deployment', async () => {
  const ctx = await setupTest();

  const result = await ctx.runBin(['start', join(ctx.root, 'src/plugin.ts')], {
    PEPYS_HOST_BIN: '/nowhere/pepys',
  });

  expect(result).toStrictEqual({
    stdout: '',
    stderr: 'the file exports a Plugin, and pepys start runs a Deployment\n',
    exitCode: 1,
  });
});
