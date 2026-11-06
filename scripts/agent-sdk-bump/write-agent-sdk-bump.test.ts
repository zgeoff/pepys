import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { stopProcessGroup } from '../test-utils/stop-process-group.ts';

function setupTest() {
  return {
    runScript: async (env: Readonly<Record<string, string | undefined>>) => {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, 'write-agent-sdk-bump.ts')],
        {
          env: { PATH: process.env['PATH'], ...env },
          stdout: 'ignore',
          stderr: 'pipe',
          detached: true,
        },
      );

      onTestFinished(() => stopProcessGroup(child));

      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);

      return { exitCode, stderr };
    },
  };
}

test('it exits 1 before it reads anything when GITHUB_OUTPUT is unset', async () => {
  const ctx = setupTest();

  const result = await ctx.runScript({});

  expect(result).toStrictEqual({ exitCode: 1, stderr: 'needs GITHUB_OUTPUT set\n' });
});
