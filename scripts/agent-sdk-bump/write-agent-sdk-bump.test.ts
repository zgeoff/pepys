import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { stopProcessGroup } from '../test-utils/stop-process-group.ts';

function setupTest() {
  return {
    // Bun gives a child a socket for stdout, where opening /dev/stdout fails with ENXIO, so a shell
    // pipe stands in. The script reads this repo's lockfiles, which CI checks out with full history.
    runScript: async (env: Readonly<Record<string, string | undefined>>) => {
      const child = Bun.spawn(
        [
          'bash',
          '-o',
          'pipefail',
          '-c',
          '"$0" "$1" | cat',
          process.execPath,
          join(import.meta.dir, 'write-agent-sdk-bump.ts'),
        ],
        {
          cwd: join(import.meta.dir, '..', '..'),
          env: { PATH: process.env['PATH'], ...env },
          stdout: 'pipe',
          stderr: 'pipe',
          detached: true,
        },
      );

      onTestFinished(() => stopProcessGroup(child));

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);

      return { exitCode, stdout, stderr };
    },
  };
}

test('it writes one bumped line to the GITHUB_OUTPUT file from the repo lockfiles', async () => {
  const ctx = setupTest();

  const result = await ctx.runScript({ GITHUB_OUTPUT: '/dev/stdout' });

  expect(result).toStrictEqual({
    exitCode: 0,
    stdout: expect.stringMatching(/^bumped=(?:true|false)\n$/u),
    stderr: '',
  });
});

test('it exits 1 before it reads anything when GITHUB_OUTPUT is unset', async () => {
  const ctx = setupTest();

  const result = await ctx.runScript({});

  expect(result).toStrictEqual({ exitCode: 1, stdout: '', stderr: 'needs GITHUB_OUTPUT set\n' });
});
