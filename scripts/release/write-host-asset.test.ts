import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stopProcessGroup } from '../utils/stop-process-group.ts';

async function setupTest() {
  const directory = await mkdtemp(join(tmpdir(), 'pepys-host-asset-'));

  onTestFinished(() => rm(directory, { recursive: true, force: true }));

  const runCommand = async (command: string[], folder: string, env: Record<string, string>) => {
    const child = Bun.spawn(command, {
      cwd: join(directory, folder),
      env,
      stdout: 'pipe',
      stderr: 'pipe',
      detached: true,
    });

    onTestFinished(() => stopProcessGroup(child));

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    return { exitCode, stdout, stderr };
  };

  return {
    directory,
    distDirectory: join(directory, 'dist'),
    runScript: (env: Record<string, string>) =>
      runCommand([process.execPath, join(import.meta.dir, 'write-host-asset.ts')], '.', env),

    // runs in the dist folder, as a deploy runs it in the folder it downloads the release into
    runSHA256SumCheck: () =>
      runCommand(['sha256sum', '-c', 'SHA256SUMS'], 'dist', { PATH: process.env['PATH'] ?? '' }),
  };
}

test('it writes the asset and a SHA256SUMS that sha256sum -c passes', async () => {
  const ctx = await setupTest();

  const binary = join(ctx.directory, 'pepys');

  await Bun.write(binary, 'a stand-in host binary\n');
  await ctx.runScript({ PEPYS_HOST_BINARY: binary, PEPYS_HOST_DIST_DIR: ctx.distDirectory });

  const result = await ctx.runSHA256SumCheck();

  expect(result).toStrictEqual({
    exitCode: 0,
    stdout: 'pepys-host-linux-x64: OK\n',
    stderr: '',
  });
});

test('it makes the asset executable', async () => {
  const ctx = await setupTest();

  const binary = join(ctx.directory, 'pepys');

  await Bun.write(binary, 'a stand-in host binary\n');
  await ctx.runScript({ PEPYS_HOST_BINARY: binary, PEPYS_HOST_DIST_DIR: ctx.distDirectory });

  const info = await stat(join(ctx.distDirectory, 'pepys-host-linux-x64'));

  expect(info.mode & 0o777).toBe(0o755);
});

test('it fails with no PEPYS_HOST_DIST_DIR', async () => {
  const ctx = await setupTest();
  const result = await ctx.runScript({ PEPYS_HOST_BINARY: join(ctx.directory, 'pepys') });

  expect(result).toStrictEqual({
    exitCode: 1,
    stdout: '',
    stderr: 'needs PEPYS_HOST_BINARY and PEPYS_HOST_DIST_DIR set\n',
  });
});
