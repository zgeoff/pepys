import { expect, test } from 'bun:test';
import { join } from 'node:path';

function setupTest() {
  return {
    runScript: async (title: string) => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'lint-title.ts')], {
        env: { ...process.env, TITLE: title },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const [stdout, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        child.exited,
      ]);

      return { exitCode, stdout };
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

  expect(result).toStrictEqual({ exitCode: 1, stdout: expect.stringContaining('type-empty') });
});
