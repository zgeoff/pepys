import { expect, onTestFinished, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stopProcessGroup } from '../utils/stop-process-group.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await mkdtemp(join(tmpdir(), 'pepys-tool-paths-'));

  stack.defer(() => rm(directory, { recursive: true, force: true }));

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
    runScript: async (hasEnvironmentFile: boolean) => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'write-tool-paths.ts')], {
        env: {
          PATH: binDirectory,
          GITHUB_ENV: hasEnvironmentFile ? environmentFile : undefined,
        },
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
  await ctx.runScript(true);

  const environmentFile = await ctx.readEnvironmentFile();

  expect(environmentFile).toBe(
    `PEPYS_ZIG_BIN=${ctx.binDirectory}/zig\nPEPYS_WASM_TOOLS_BIN=${ctx.binDirectory}/wasm-tools\n`,
  );
});

test.each([
  { missing: 'wasm-tools on PATH', tools: ['zig'], hasEnvironmentFile: true },
  { missing: 'zig on PATH', tools: ['wasm-tools'], hasEnvironmentFile: true },
  { missing: 'GITHUB_ENV', tools: ['zig', 'wasm-tools'], hasEnvironmentFile: false },
])('it exits 1 and writes nothing when $missing is missing', async (row) => {
  const ctx = await setupTest();

  await Promise.all(row.tools.map((tool) => ctx.writeTool(tool)));

  const result = await ctx.runScript(row.hasEnvironmentFile);
  const environmentFile = await ctx.readEnvironmentFile();

  expect({ ...result, environmentFile }).toStrictEqual({
    exitCode: 1,
    stderr: 'needs GITHUB_ENV set, and zig and wasm-tools on PATH\n',
    environmentFile: null,
  });
});
