import { expect, onTestFinished, test } from 'bun:test';
import { mkdtemp, readFile, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import invariant from 'tiny-invariant';
import { readRunPrefix } from '../test-utils/read-run-prefix.ts';
import { stopProcessGroup } from '../utils/stop-process-group.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const prefix = await readRunPrefix(readlink, process.pid);
  const directory = await mkdtemp(join(tmpdir(), `${prefix}agent-sdk-bump-`));

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const outputFile = join(directory, 'github-output');
  const repository = join(directory, 'repo');

  const runProcess = async (
    command: readonly string[],
    cwd: string,
    env: Readonly<Record<string, string | undefined>>,
  ) => {
    const child = Bun.spawn([...command], {
      cwd,
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
      repository,
      process.env,
    );

    invariant(result.exitCode === 0, result.stderr);
  };

  await runProcess(
    ['git', 'init', '--quiet', '--initial-branch=main', repository],
    directory,
    process.env,
  );

  return {
    outputFile,
    seed: {
      // The merge commit's first parent holds the base lockfile, as in a pull_request checkout.
      pullRequestMerge: async (baseLockfile: string, headLockfile: string) => {
        await Bun.write(join(repository, 'bun.lock'), baseLockfile);

        await git(['add', 'bun.lock']);
        await git(['commit', '--quiet', '-m', 'base']);
        await git(['switch', '--quiet', '-c', 'feature']);

        await Bun.write(join(repository, 'bun.lock'), headLockfile);

        await git(['commit', '--quiet', '-am', 'head']);
        await git(['switch', '--quiet', 'main']);
        await git(['merge', '--quiet', '--no-ff', '-m', 'merge', 'feature']);
      },
    },
    runScript: (env: Readonly<Record<string, string | undefined>>) =>
      runProcess([process.execPath, join(import.meta.dir, 'write-agent-sdk-bump.ts')], repository, {
        PATH: process.env['PATH'],
        ...env,
      }),
    readOutputFile: () => readFile(outputFile, 'utf8'),
  };
}

test('it writes bumped=true to GITHUB_OUTPUT when the merge changes the SDK release', async () => {
  const ctx = await setupTest();

  await ctx.seed.pullRequestMerge(
    `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], }, }`,
    `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.2", "", {}, "sha512-b"], }, }`,
  );

  const result = await ctx.runScript({ GITHUB_OUTPUT: ctx.outputFile });
  const output = await ctx.readOutputFile();

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
  expect(output).toBe('bumped=true\n');
});

test('it writes bumped=false to GITHUB_OUTPUT when the merge keeps the SDK release', async () => {
  const ctx = await setupTest();

  await ctx.seed.pullRequestMerge(
    `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], "kysely": ["kysely@0.29.6", "", {}, "sha512-j"], }, }`,
    `{ "packages": { "@anthropic-ai/claude-agent-sdk": ["@anthropic-ai/claude-agent-sdk@0.3.1", "", {}, "sha512-a"], "kysely": ["kysely@0.29.7", "", {}, "sha512-k"], }, }`,
  );

  const result = await ctx.runScript({ GITHUB_OUTPUT: ctx.outputFile });
  const output = await ctx.readOutputFile();

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
  expect(output).toBe('bumped=false\n');
});

test('it exits 1 before it reads anything when GITHUB_OUTPUT is unset', async () => {
  const ctx = await setupTest();
  const result = await ctx.runScript({});

  expect(result).toStrictEqual({ exitCode: 1, stderr: 'needs GITHUB_OUTPUT set\n' });
});
