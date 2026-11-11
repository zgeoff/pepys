// Installs every public `@pepys/*` package into a new folder outside the repo, builds a stub
// deployment's consumers there, and runs a host with `run --up` on s2-lite until each is current.
// AGENTS.md lists the variables that pick the packages and the host.
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createS2FactLog } from '@pepys/ingest';
import type { StreamName } from '@pepys/kit';
import { consumerBuildManifestSchema } from '@pepys/schema';
import { toTagged } from '@zgeoff/std';
import { buildStackEnv } from '../../stack/build-stack-env.ts';
import { withStack } from '../../stack/with-stack.ts';
import type { RunningStack } from '../../stack/with-stack.ts';
import { collectSumsProblems } from '../release/collect-sums-problems.ts';
import { HOST_ASSET_NAME, SUMS_FILE_NAME } from '../release/constants.ts';
import { readSHA256 } from '../release/read-sha256.ts';
import { stopProcessGroup } from '../utils/stop-process-group.ts';
import { buildOutsideDeployment } from './build-outside-deployment.ts';
import { collectLaggingConsumers } from './collect-lagging-consumers.ts';
import { pickHostSource } from './pick-host-source.ts';
import type { HostSource } from './pick-host-source.ts';
import { readOutsideInputs } from './read-outside-inputs.ts';
import { runStep } from './run-step.ts';
import { writeProjectFiles } from './write-project-files.ts';

const root = join(import.meta.dir, '..', '..');
const caughtUpDeadlineMs = 120_000;

const hostSource = pickHostSource({
  binary: process.env['PEPYS_OUTSIDE_HOST'],
  tag: process.env['PEPYS_OUTSIDE_HOST_TAG'],
  localBuild: join(root, 'target/debug/pepys'),
});

if (hostSource.kind === 'conflict') {
  console.error('set PEPYS_OUTSIDE_HOST or PEPYS_OUTSIDE_HOST_TAG, not both');
  process.exit(1);
}

// os.tmpdir() has no package.json or node_modules above it, so nothing from the repo resolves there
const directory = await mkdtemp(join(tmpdir(), 'pepys-outside-deployment-'));

const project = join(directory, 'project');

try {
  const input = await readOutsideInputs(root, directory);

  await writeProjectFiles(project, buildOutsideDeployment(input));

  // a fresh cache, so a repacked tarball of an unchanged version cannot come from an older install
  await runStep(project, [process.execPath, 'install', '--cache-dir', join(directory, 'cache')]);

  await runStep(project, [
    process.execPath,
    'run',
    'pepys',
    'build',
    'src/deployment.ts',
    '--out',
    'build',
  ]);

  const host = await readHost(hostSource, join(directory, 'host'));

  await withStack((stack) =>
    runHostUntilCurrent({
      host,
      consumersPath: join(project, 'build/consumers.json'),
      storeDirectory: join(directory, 'store'),
      stack,
    }),
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}

// The path of a host binary that starts: the local one as it is, or a release's asset, downloaded
// into `folder` and checked against the release's sums file.
async function readHost(
  source: Exclude<HostSource, { kind: 'conflict' }>,
  folder: string,
): Promise<string> {
  if (source.kind === 'local') {
    if (!existsSync(source.binary)) {
      throw new Error(`no host binary at ${source.binary}: run cargo build --bin pepys --locked`);
    }

    return source.binary;
  }

  await mkdir(folder);

  const asset = join(folder, HOST_ASSET_NAME);

  const assetBytes = await readDownload(source.assetURL);

  await Bun.write(asset, assetBytes);

  const sumsBytes = await readDownload(source.sumsURL);
  const assetSHA256 = await readSHA256(asset);

  const problems = collectSumsProblems(new TextDecoder().decode(sumsBytes), assetSHA256);

  if (problems.length > 0) {
    throw new Error(`the host asset of ${source.tag} fails its check: ${problems.join('; ')}`);
  }

  await chmod(asset, 0o755);

  console.log(`the host of ${source.tag} matches its ${SUMS_FILE_NAME}`);

  return asset;
}

async function readDownload(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }

  return response.arrayBuffer();
}

interface HostRun {
  host: string;
  consumersPath: string;
  storeDirectory: string;
  stack: RunningStack;
}

// Starts `run --up`, waits until each listed consumer's `current` link names its listed version,
// then stops the host and checks that it stopped cleanly.
async function runHostUntilCurrent(run: HostRun): Promise<void> {
  const fileText: unknown = await Bun.file(run.consumersPath).json();

  const listed = consumerBuildManifestSchema.parse(fileText).consumers;

  // ingest creates the basin and each stream when it starts, and the host reads only what exists
  await createS2FactLog({
    endpoint: run.stack.s2Endpoint,
    accessToken: run.stack.s2AccessToken,
    basin: run.stack.s2Basin,
    streams: [...new Set(listed.flatMap((consumer) => consumer.manifest.input.streams))].map(
      (stream) => toTagged<StreamName>(stream),
    ),
  });

  const child = Bun.spawn([run.host, 'run', '--up'], {
    env: {
      ...process.env,
      ...buildStackEnv(run.stack),
      PEPYS_CONSUMERS: run.consumersPath,
      PEPYS_STORE_DIR: run.storeDirectory,
    },
    stdout: 'inherit',
    stderr: 'inherit',
    detached: true,
  });

  const deadline = Date.now() + caughtUpDeadlineMs;
  let lagging = listed.map((consumer) => consumer.name);

  try {
    while (lagging.length > 0 && Date.now() < deadline && child.exitCode === null) {
      run.stack.stop.throwIfAborted();

      await Bun.sleep(200);

      const current = new Map<string, string | null>();

      for (const consumer of listed) {
        const version = await readCurrentVersion(run.storeDirectory, consumer.name);

        current.set(consumer.name, version);
      }

      lagging = collectLaggingConsumers(listed, current);
    }
  } finally {
    await stopProcessGroup(child);
  }

  if (lagging.length > 0) {
    throw new Error(`pepys run --up gave no current version to ${lagging.join(', ')}`);
  }

  // SIGTERM is the host's own stop, so any other exit code is a failure
  if (child.exitCode !== 0) {
    throw new Error(`pepys run --up exited with ${child.exitCode} on SIGTERM`);
  }

  console.log(`pepys run --up made current: ${listed.map((consumer) => consumer.name).join(', ')}`);
}

// the version that the consumer's `current` link names, or null when it has none
function readCurrentVersion(storeDirectory: string, consumer: string): Promise<string | null> {
  return readlink(join(storeDirectory, consumer, 'current')).catch(() => null);
}
