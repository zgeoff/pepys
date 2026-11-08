import { expect, onTestFinished, test } from 'bun:test';
import { join } from 'node:path';
import { stopProcessGroup } from '../utils/stop-process-group.ts';

function setupTest() {
  return {
    runScript: async (results: string) => {
      const child = Bun.spawn([process.execPath, join(import.meta.dir, 'require-every-check.ts')], {
        env: { RESULTS: results },
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
  };
}

test('it passes when every job succeeded or was skipped', async () => {
  const ctx = setupTest();

  const result = await ctx.runScript('success skipped success');

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
});

test('it fails and names each result that is not a success or a skip', async () => {
  const ctx = setupTest();

  const result = await ctx.runScript('success failure cancelled');

  expect(result).toStrictEqual({
    exitCode: 1,
    stderr: 'a required job ended as failure\na required job ended as cancelled\n',
  });
});

test('it fails when RESULTS holds no job results', async () => {
  const ctx = setupTest();

  const result = await ctx.runScript('');

  expect(result).toStrictEqual({ exitCode: 1, stderr: 'RESULTS holds no job results\n' });
});
