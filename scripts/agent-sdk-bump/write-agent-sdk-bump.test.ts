import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { formatRunPrefix } from '../test-utils/format-run-prefix.ts';
import { readPIDNamespace } from '../test-utils/read-pid-namespace.ts';
import { stopProcessGroup } from '../test-utils/stop-process-group.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const namespace = await readPIDNamespace();

  const prefix = formatRunPrefix(process.pid, namespace);

  const directory = await mkdtemp(join(tmpdir(), `${prefix}pepys-agent-sdk-bump-`));

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const outputFile = join(directory, 'github-output');

  const runProcess = async (
    command: readonly string[],
    env: Readonly<Record<string, string | undefined>>,
  ) => {
    const child = Bun.spawn([...command], {
      cwd: directory,
      env,
      stdout: 'ignore',
      stderr: 'pipe',
      detached: true,
    });

    stack.defer(() => stopProcessGroup(child));

    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);

    return { exitCode, stderr };
  };

  const git = async (args: readonly string[]) => {
    const result = await runProcess(
      [
        'git',
        '-c',
        'user.name=pepys-test',
        '-c',
        'user.email=pepys-test@example.com',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      process.env,
    );

    invariant(result.exitCode === 0, result.stderr);
  };

  await git(['init', '--quiet']);

  return {
    seed: {
      lockfileCommit: async (lockfile: string) => {
        await Bun.write(join(directory, 'bun.lock'), lockfile);

        await git(['add', 'bun.lock']);
        await git(['commit', '--quiet', '-m', 'lock']);
      },
    },
    runScript: (env: Readonly<Record<string, string | undefined>>) =>
      runProcess([process.execPath, join(import.meta.dir, 'write-agent-sdk-bump.ts')], {
        PATH: process.env['PATH'],
        ...env,
      }),
    outputFile,
    readOutputFile: async () => {
      const file = Bun.file(outputFile);

      const exists = await file.exists();

      return exists ? file.text() : null;
    },
  };
}

test('it writes bumped=true to GITHUB_OUTPUT when the head commit locks a new SDK release', async () => {
  const ctx = await setupTest();

  await ctx.seed.lockfileCommit(
    `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], }, }`,
  );

  await ctx.seed.lockfileCommit(
    `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.2", "", {}, "sha512-b"], }, }`,
  );

  const result = await ctx.runScript({ GITHUB_OUTPUT: ctx.outputFile });
  const output = await ctx.readOutputFile();

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
  expect(output).toBe('bumped=true\n');
});

test('it writes bumped=false to GITHUB_OUTPUT when the head commit keeps the SDK release', async () => {
  const ctx = await setupTest();

  await ctx.seed.lockfileCommit(
    `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], "kysely": ["kysely@0.29.6", "", {}, "sha512-j"], }, }`,
  );

  await ctx.seed.lockfileCommit(
    `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], "kysely": ["kysely@0.29.7", "", {}, "sha512-k"], }, }`,
  );

  const result = await ctx.runScript({ GITHUB_OUTPUT: ctx.outputFile });
  const output = await ctx.readOutputFile();

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
  expect(output).toBe('bumped=false\n');
});

test('it exits 1 and writes nothing when GITHUB_OUTPUT is unset', async () => {
  const ctx = await setupTest();
  const result = await ctx.runScript({});
  const output = await ctx.readOutputFile();

  expect(result).toStrictEqual({ exitCode: 1, stderr: 'needs GITHUB_OUTPUT set\n' });
  expect(output).toBeNull();
});
