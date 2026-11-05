import { expect, onTestFinished, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatRunPrefix } from '../test-utils/format-run-prefix.ts';
import { readPIDNamespace } from '../test-utils/read-pid-namespace.ts';
import { stopProcessGroup } from '../test-utils/stop-process-group.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const namespace = await readPIDNamespace();

  const directory = await mkdtemp(
    join(tmpdir(), `${formatRunPrefix(process.pid, namespace)}test-leftovers-`),
  );

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  return {
    namespace,
    seed: {
      folder: (name: string) => mkdir(join(directory, name)),
    },
    runScript: async () => {
      const child = Bun.spawn(
        [process.execPath, join(import.meta.dir, 'remove-test-leftovers.ts')],
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
    readFolderNames: async () => {
      const names = await readdir(directory);

      return names.toSorted();
    },
  };
}

test('it removes a folder of this namespace whose process no longer runs', async () => {
  const ctx = await setupTest();

  await ctx.seed.folder(`pid2147483647-ns${ctx.namespace}-ledger-a1b2c3`);

  const result = await ctx.runScript();
  const names = await ctx.readFolderNames();

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
  expect(names).toStrictEqual([]);
});

test('it never removes the files of a run that is still going', async () => {
  const ctx = await setupTest();

  await ctx.seed.folder(`pid${process.pid}-ns${ctx.namespace}-ledger-a1b2c3`);

  const result = await ctx.runScript();
  const names = await ctx.readFolderNames();

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
  expect(names).toStrictEqual([`pid${process.pid}-ns${ctx.namespace}-ledger-a1b2c3`]);
});

test('it never removes a folder of another namespace or one with no run prefix', async () => {
  const ctx = await setupTest();

  await ctx.seed.folder('ledger-a1b2c3');
  await ctx.seed.folder('pid2147483647-ns1-ledger-a1b2c3');

  const result = await ctx.runScript();
  const names = await ctx.readFolderNames();

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
  expect(names).toStrictEqual(['ledger-a1b2c3', 'pid2147483647-ns1-ledger-a1b2c3']);
});
