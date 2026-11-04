import { expect, onTestFinished, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function setupTest() {
  const directory = await mkdtemp(join(tmpdir(), 'pepys-tool-paths-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const binDirectory = join(directory, 'bin');
  const environmentFile = join(directory, 'github-env');

  await mkdir(binDirectory);

  return {
    binDirectory,
    writeTool: async (name: string) => {
      const path = join(binDirectory, name);

      await Bun.write(path, '#!/bin/sh\n');

      await chmod(path, 0o755);
    },
    runScript: async () => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'write-tool-paths.ts')], {
        env: { PATH: binDirectory, GITHUB_ENV: environmentFile },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);

      return { exitCode, stderr };
    },
    readEnvironmentFile: async () => {
      const file = Bun.file(environmentFile);

      const exists = await file.exists();

      return exists ? file.text() : null;
    },
  };
}

test('it writes the zig and wasm-tools paths to GITHUB_ENV when PATH holds both', async () => {
  const ctx = await setupTest();

  await ctx.writeTool('zig');
  await ctx.writeTool('wasm-tools');
  await ctx.runScript();

  const environmentFile = await ctx.readEnvironmentFile();

  expect(environmentFile).toBe(
    `PEPYS_ZIG_BIN=${ctx.binDirectory}/zig\nPEPYS_WASM_TOOLS_BIN=${ctx.binDirectory}/wasm-tools\n`,
  );
});

test('it exits 1 and writes nothing when PATH has no wasm-tools', async () => {
  const ctx = await setupTest();

  await ctx.writeTool('zig');

  const result = await ctx.runScript();
  const environmentFile = await ctx.readEnvironmentFile();

  expect({ ...result, environmentFile }).toStrictEqual({
    exitCode: 1,
    stderr: 'needs GITHUB_ENV set, and zig and wasm-tools on PATH\n',
    environmentFile: null,
  });
});
