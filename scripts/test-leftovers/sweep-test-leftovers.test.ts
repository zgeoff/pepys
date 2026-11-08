import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRunPrefix } from '../test-utils/read-run-prefix.ts';
import { stopProcessGroup } from '../test-utils/stop-process-group.ts';
import { readPIDNamespace } from '../utils/read-pid-namespace.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const namespace = await readPIDNamespace(readlink);
  const prefix = await readRunPrefix(readlink, process.pid);
  const directory = await mkdtemp(join(tmpdir(), `${prefix}test-leftovers-`));

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  return {
    namespace,
    seed: {
      folder: (name: string) => mkdir(join(directory, name)),
    },
    runScript: async () => {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, 'sweep-test-leftovers.ts')],
        {
          env: { PATH: process.env['PATH'], TMPDIR: directory },
          stdout: 'ignore',
          stderr: 'pipe',
          detached: true,
        },
      );

      stack.defer(() => stopProcessGroup(child));

      const [stderr, exitCode] = await Promise.all([
        new Response(child.stderr).text(),
        child.exited,
      ]);

      return { exitCode, stderr };
    },
    readFolderNames: () => readdir(directory),
  };
}

// Only Linux has PID namespaces, and the sweep removes nothing without one.
test.skipIf(process.platform !== 'linux')(
  'it removes a folder of this namespace in the temp folder whose process no longer runs',
  async () => {
    const ctx = await setupTest();

    await ctx.seed.folder(`pid2147483647-ns${ctx.namespace}-ledger-a1b2c3`);

    const result = await ctx.runScript();
    const names = await ctx.readFolderNames();

    expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
    expect(names).toStrictEqual([]);
  },
);

test('it never removes the files in the temp folder of a run that is still going', async () => {
  const ctx = await setupTest();

  await ctx.seed.folder(`pid${process.pid}-ns${ctx.namespace}-ledger-a1b2c3`);

  const result = await ctx.runScript();
  const names = await ctx.readFolderNames();

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
  expect(names).toStrictEqual([`pid${process.pid}-ns${ctx.namespace}-ledger-a1b2c3`]);
});
