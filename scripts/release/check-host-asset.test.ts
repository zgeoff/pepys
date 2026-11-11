import { expect, onTestFinished, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stopProcessGroup } from '../utils/stop-process-group.ts';

async function setupTest() {
  const directory = await mkdtemp(join(tmpdir(), 'pepys-check-host-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const binDirectory = join(directory, 'bin');
  const binary = join(directory, 'pepys');
  const distDirectory = join(directory, 'dist');

  // A stand-in objdump on PATH that prints the symbol table in OBJDUMP_TEXT.
  await Bun.write(join(binDirectory, 'objdump'), '#!/bin/sh\nprintf "%s" "$OBJDUMP_TEXT"\n');

  await chmod(join(binDirectory, 'objdump'), 0o755);

  const runScript = async (fileName: string, env: Record<string, string>) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, fileName)], {
      env: {
        PATH: `${binDirectory}:${process.env['PATH'] ?? ''}`,
        PEPYS_HOST_BINARY: binary,
        PEPYS_HOST_DIST_DIR: distDirectory,
        ...env,
      },
      stdout: 'ignore',
      stderr: 'pipe',
      detached: true,
    });

    onTestFinished(() => stopProcessGroup(child));

    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);

    return { exitCode, stderr };
  };

  return {
    writeBinary: async (script: string) => {
      await Bun.write(binary, script);

      await chmod(binary, 0o755);
    },
    writeAsset: () => runScript('write-host-asset.ts', {}),
    runScript: (objdumpText: string) =>
      runScript('check-host-asset.ts', { OBJDUMP_TEXT: objdumpText }),
  };
}

test('it passes an asset that matches the binary and its sums, and starts', async () => {
  const ctx = await setupTest();

  await ctx.writeBinary('#!/bin/sh\nexit 0\n');
  await ctx.writeAsset();

  const result = await ctx.runScript('0000 DF *UND* 0000 (GLIBC_2.34) __libc_start_main\n');

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
});

test('it fails an asset that is not the built binary', async () => {
  const ctx = await setupTest();

  await ctx.writeBinary('#!/bin/sh\nexit 0\n');
  await ctx.writeAsset();
  await ctx.writeBinary('#!/bin/sh\necho rebuilt\n');

  const result = await ctx.runScript('');

  expect(result).toStrictEqual({
    exitCode: 1,
    stderr: expect.stringContaining('pepys-host-linux-x64 is not the binary at'),
  });
});

test('it fails an asset that needs a glibc newer than the floor', async () => {
  const ctx = await setupTest();

  await ctx.writeBinary('#!/bin/sh\nexit 0\n');
  await ctx.writeAsset();

  const result = await ctx.runScript('0000 DF *UND* 0000 (GLIBC_2.38) __isoc23_strtol\n');

  expect(result).toStrictEqual({
    exitCode: 1,
    stderr: 'pepys-host-linux-x64 needs glibc 2.38, newer than 2.35\n',
  });
});

test('it fails an asset that does not start', async () => {
  const ctx = await setupTest();

  await ctx.writeBinary('#!/bin/sh\nexit 3\n');
  await ctx.writeAsset();

  const result = await ctx.runScript('');

  expect(result).toStrictEqual({
    exitCode: 1,
    stderr: 'pepys-host-linux-x64 --help exited with 3\n',
  });
});

test('it fails with no SHA256SUMS', async () => {
  const ctx = await setupTest();
  const result = await ctx.runScript('');

  expect(result).toStrictEqual({
    exitCode: 1,
    stderr: 'SHA256SUMS is missing\npepys-host-linux-x64 is missing\n',
  });
});
