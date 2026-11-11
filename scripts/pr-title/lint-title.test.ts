import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { stopProcessGroup } from '../utils/stop-process-group.ts';

function setupTest() {
  return {
    runScript: async (title: string | undefined) => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'lint-title.ts')], {
        env: { ...process.env, TITLE: title },
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
    },
  };
}

test('it passes a Conventional Commits title', async () => {
  const ctx = setupTest();

  const result = await ctx.runScript('fix(api): return a miss for an unknown entity');

  expect(result.exitCode).toBe(0);
});

test('it fails a title with no type and names the broken rule', async () => {
  const ctx = setupTest();

  const result = await ctx.runScript('Return a miss for an unknown entity');

  expect(result).toStrictEqual({
    exitCode: 1,
    stdout: expect.stringContaining('type-empty'),
    stderr: expect.any(String),
  });
});

test('it exits 1 and asks for TITLE when TITLE is unset', async () => {
  const ctx = setupTest();

  const result = await ctx.runScript(undefined);

  expect(result).toStrictEqual({
    exitCode: 1,
    stdout: '',
    stderr: 'set TITLE to the pull request title\n',
  });
});
