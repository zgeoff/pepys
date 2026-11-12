import { expect, onTestFinished, test } from 'bun:test';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stopProcessGroup } from '../utils/stop-process-group.ts';

async function setupTest() {
  const stack = new AsyncDisposableStack();

  onTestFinished(() => stack.disposeAsync());

  const directory = await mkdtemp(join(tmpdir(), 'pepys-host-release-'));

  stack.defer(() => rm(directory, { recursive: true, force: true }));

  const binDirectory = join(directory, 'bin');
  const log = join(directory, 'gh.log');
  const releasesFile = join(directory, 'releases.json');
  const publishedDirectory = join(directory, 'published');

  // A stand-in gh on PATH: the release list prints GH_RELEASES, a download copies the files of
  // GH_PUBLISHED_DIR into the --dir folder or exits with GH_DOWNLOAD_EXIT when set, and every call
  // is logged.
  await Bun.write(
    join(binDirectory, 'gh'),
    `#!/bin/sh
echo "$*" >> "$GH_LOG"
case "$1 $2" in
  "api --paginate") cat "$GH_RELEASES" ;;
  "release download")
    if [ -n "$GH_DOWNLOAD_EXIT" ]; then echo "HTTP 502" >&2; exit "$GH_DOWNLOAD_EXIT"; fi
    while [ $# -gt 0 ]; do
      if [ "$1" = --dir ]; then cp "$GH_PUBLISHED_DIR"/* "$2"/; fi
      shift
    done ;;
  "release create") echo "https://github.com/example/pepys/releases/tag/v1.0.0" ;;
esac
`,
  );

  await chmod(join(binDirectory, 'gh'), 0o755);

  const runScript = async (fileName: string, env: Record<string, string>) => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, fileName)], {
      env: {
        PATH: `${binDirectory}:${process.env['PATH'] ?? ''}`,
        GH_LOG: log,
        GH_RELEASES: releasesFile,
        GH_PUBLISHED_DIR: publishedDirectory,
        ...env,
      },
      stdout: 'ignore',
      stderr: 'pipe',
      detached: true,
    });

    stack.defer(() => stopProcessGroup(child));

    const [stderr, exitCode] = await Promise.all([new Response(child.stderr).text(), child.exited]);

    return { exitCode, stderr };
  };

  return {
    directory,
    distDirectory: join(directory, 'dist'),
    publishedDirectory,
    writeReleases: (pages: unknown) => Bun.write(releasesFile, JSON.stringify(pages)),
    writePublishedFiles: async (binaryText: string) => {
      const binary = join(directory, 'pepys');

      await Bun.write(binary, binaryText);

      return runScript('write-host-asset.ts', {
        PEPYS_HOST_BINARY: binary,
        PEPYS_HOST_DIST_DIR: publishedDirectory,
      });
    },
    readLogLines: async () => {
      const text = await Bun.file(log).text();

      return text.trimEnd().split('\n');
    },
    runScript: (env: Record<string, string>) => runScript('publish-host-release.ts', env),
  };
}

test('it creates the release with the asset and SHA256SUMS when the tag has none', async () => {
  const ctx = await setupTest();

  await ctx.writeReleases([[{ id: 3, tag_name: 'v0.9.0', draft: false }]]);
  await ctx.runScript({ RELEASE_TAG: 'v1.0.0', PEPYS_HOST_DIST_DIR: ctx.distDirectory });

  const lines = await ctx.readLogLines();

  expect(lines).toStrictEqual([
    'api --paginate --slurp repos/{owner}/{repo}/releases',
    `release create v1.0.0 --verify-tag --title v1.0.0 --notes The pepys host for linux x64, which needs glibc 2.35 or later. Check pepys-host-linux-x64 with \`sha256sum -c SHA256SUMS\`. ${join(ctx.distDirectory, 'pepys-host-linux-x64')} ${join(ctx.distDirectory, 'SHA256SUMS')}`,
  ]);
});

test('it removes a draft of the tag that a cut-off run left, then creates the release', async () => {
  const ctx = await setupTest();

  await ctx.writeReleases([[{ id: 12, tag_name: 'v1.0.0', draft: true }]]);
  await ctx.runScript({ RELEASE_TAG: 'v1.0.0', PEPYS_HOST_DIST_DIR: ctx.distDirectory });

  const lines = await ctx.readLogLines();

  expect(lines).toStrictEqual([
    'api --paginate --slurp repos/{owner}/{repo}/releases',
    'api --method DELETE repos/{owner}/{repo}/releases/12',
    expect.stringMatching(/^release create v1\.0\.0 /u),
  ]);
});

test('it leaves a published release whose files agree and passes', async () => {
  const ctx = await setupTest();

  await ctx.writeReleases([[{ id: 7, tag_name: 'v1.0.0', draft: false }]]);
  await ctx.writePublishedFiles('the binary of the first run\n');

  const result = await ctx.runScript({
    RELEASE_TAG: 'v1.0.0',
    PEPYS_HOST_DIST_DIR: ctx.distDirectory,
  });

  expect(result).toStrictEqual({ exitCode: 0, stderr: '' });
});

test('it never uploads to a published release', async () => {
  const ctx = await setupTest();

  await ctx.writeReleases([[{ id: 7, tag_name: 'v1.0.0', draft: false }]]);
  await ctx.writePublishedFiles('the binary of the first run\n');
  await ctx.runScript({ RELEASE_TAG: 'v1.0.0', PEPYS_HOST_DIST_DIR: ctx.distDirectory });

  const lines = await ctx.readLogLines();

  expect(lines).toSatisfyAll(
    (line: string) => !line.startsWith('release create') && !line.startsWith('release upload'),
  );
});

test('it fails a published release whose asset disagrees with its SHA256SUMS', async () => {
  const ctx = await setupTest();

  await ctx.writeReleases([[{ id: 7, tag_name: 'v1.0.0', draft: false }]]);
  await ctx.writePublishedFiles('the binary of the first run\n');
  await Bun.write(join(ctx.publishedDirectory, 'pepys-host-linux-x64'), 'another binary\n');

  const result = await ctx.runScript({
    RELEASE_TAG: 'v1.0.0',
    PEPYS_HOST_DIST_DIR: ctx.distDirectory,
  });

  expect(result).toStrictEqual({
    exitCode: 1,
    stderr: expect.stringContaining(
      'the published release v1.0.0 has files that disagree; delete it, then rerun',
    ),
  });
});

test('it fails without judging a published release whose files it could not download', async () => {
  const ctx = await setupTest();

  await ctx.writeReleases([[{ id: 7, tag_name: 'v1.0.0', draft: false }]]);

  const result = await ctx.runScript({
    RELEASE_TAG: 'v1.0.0',
    PEPYS_HOST_DIST_DIR: ctx.distDirectory,
    GH_DOWNLOAD_EXIT: '1',
  });

  expect(result).toStrictEqual({
    exitCode: 1,
    stderr: 'HTTP 502\ngh release download exited with 1\n',
  });
});

test('it fails with no RELEASE_TAG', async () => {
  const ctx = await setupTest();
  const result = await ctx.runScript({ PEPYS_HOST_DIST_DIR: ctx.distDirectory });

  expect(result).toStrictEqual({
    exitCode: 1,
    stderr: 'needs RELEASE_TAG and PEPYS_HOST_DIST_DIR set\n',
  });
});
